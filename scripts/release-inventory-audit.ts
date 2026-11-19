/** Read-only release gate: complete primary source plus every registered worktree. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { auditReleaseScope, hashFile, type ReleaseDeferral } from "./release-scope-audit";

export type TreeDecision = { path: string; fingerprint: string; reason: string };
export type ReleaseDecisions = { primary: ReleaseDeferral[]; worktrees: TreeDecision[] };
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

export function auditReleaseInventory(repo: string, source: string, decisions: ReleaseDecisions = { primary: [], worktrees: [] }) {
  repo = realpathSync(repo); source = realpathSync(source);
  const primary = auditReleaseScope(repo, source, decisions.primary);
  const trees = git(repo, "worktree", "list", "--porcelain", "-z").split("\0\0").filter(Boolean).map(record => {
    const fields = record.split("\0");
    return { path: fields.find(f => f.startsWith("worktree "))!.slice(9), head: fields.find(f => f.startsWith("HEAD "))?.slice(5) ?? "" };
  }).filter(tree => path.resolve(tree.path) !== repo && (!existsSync(tree.path) || realpathSync(tree.path) !== repo));
  const worktrees = trees.map(tree => {
    if (!existsSync(tree.path)) {
      const state = { ...tree, missing: true, commits: [] as string[], differences: [] as typeof primary.differences };
      return { ...state, fingerprint: digest(state), needsReview: true };
    }
    const head = git(tree.path, "rev-parse", "HEAD").trim();
    const base = git(repo, "merge-base", primary.head, head).trim();
    const commits = git(repo, "rev-list", `${primary.head}..${head}`).trim().split("\n").filter(Boolean);
    const files = [...new Set([
      ...git(tree.path, "diff", base, "--name-only", "--no-renames", "-z").split("\0"),
      ...git(tree.path, "ls-files", "--others", "--exclude-standard", "-z").split("\0"),
    ].filter(Boolean))].sort();
    const differences = files.flatMap(file => {
      const workspaceHash = hashFile(path.join(tree.path, file)), releaseHash = hashFile(path.join(source, file));
      return workspaceHash === releaseHash ? [] : [{ path: file, workspaceHash, releaseHash }];
    });
    const state = { path: tree.path, head, missing: false, commits, differences };
    return { ...state, fingerprint: digest(state), needsReview: differences.length > 0 };
  });
  const errors = [...primary.errors];
  const seen = new Set<string>();
  for (const decision of decisions.worktrees) {
    const tree = worktrees.find(t => t.path === decision.path && t.needsReview);
    if (seen.has(decision.path)) errors.push(`Duplicate worktree decision: ${decision.path}`);
    seen.add(decision.path);
    if (!tree || tree.fingerprint !== decision.fingerprint || !decision.reason?.trim()) errors.push(`Stale or invalid worktree decision: ${decision.path}`);
  }
  for (const tree of worktrees) {
    if (tree.needsReview && !decisions.worktrees.some(d => d.path === tree.path && d.fingerprint === tree.fingerprint && d.reason?.trim())) errors.push(`Unreviewed worktree: ${tree.path}`);
  }
  // Include every expected source path, including explicit deferrals/deletions, to seal the build.
  const files = [...primary.included, ...primary.differences.map(d => d.path)].sort().map(file => ({ path: file, hash: hashFile(path.join(source, file)) }));
  return { schemaVersion: 1 as const, repo, source, sourceKind: "snapshot" as const, head: primary.head, primary, worktrees, decisions, files, sourceDigest: digest(files), errors, ok: errors.length === 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const [source, file] = process.argv.slice(2);
    if (!source) throw new Error("Usage: node --import tsx scripts/release-inventory-audit.ts SOURCE [DECISIONS.json]");
    const decisions = file ? JSON.parse(readFileSync(file, "utf8")) : undefined;
    if (decisions && (!Array.isArray(decisions.primary) || !Array.isArray(decisions.worktrees))) throw new Error("Decisions need primary and worktrees arrays");
    const report = auditReleaseInventory(process.cwd(), source, decisions);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
