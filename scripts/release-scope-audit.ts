/** Compare every non-ignored working-tree change with the exact release source.
 * No writes, no staging, no credentials, no deployment. Exceptions are bound to
 * both file hashes so a new edit cannot inherit an old decision silently.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type ReleaseDifference = {
  path: string;
  workspaceHash: string | null;
  releaseHash: string | null;
};
export type ReleaseDeferral = ReleaseDifference & { reason: string };

function hashFile(file: string): string | null {
  try {
    if (!lstatSync(file).isFile()) throw new Error(`Expected a regular file: ${file}`);
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function auditReleaseScope(repo: string, source: string, deferrals: ReleaseDeferral[] = []) {
  repo = realpathSync(repo);
  source = realpathSync(source);
  if (repo === source) throw new Error("Release source must be an independent snapshot");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  const paths = [...new Set([
    ...git("diff", "HEAD", "--name-only", "--no-renames", "-z").split("\0"),
    ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0"),
  ].filter(Boolean))].sort();
  const included: string[] = [];
  const differences: ReleaseDifference[] = [];
  for (const file of paths) {
    const workspaceHash = hashFile(path.join(repo, file));
    const releaseHash = hashFile(path.join(source, file));
    if (workspaceHash === releaseHash) included.push(file);
    else differences.push({ path: file, workspaceHash, releaseHash });
  }
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const item of deferrals) {
    if (!item || typeof item.path !== "string" || typeof item.reason !== "string" || !item.reason.trim()) {
      errors.push("Every deferred file needs a path, both hashes and a concrete reason");
      continue;
    }
    if (seen.has(item.path)) errors.push(`Duplicate deferral: ${item.path}`);
    seen.add(item.path);
    const actual = differences.find(diff => diff.path === item.path);
    if (!actual || actual.workspaceHash !== item.workspaceHash || actual.releaseHash !== item.releaseHash) {
      errors.push(`Stale deferral: ${item.path}`);
    }
  }
  for (const item of differences) {
    if (!deferrals.some(saved => saved?.path === item.path && saved.workspaceHash === item.workspaceHash &&
      saved.releaseHash === item.releaseHash && typeof saved.reason === "string" && saved.reason.trim())) {
      errors.push(`Unaccounted release difference: ${item.path}`);
    }
  }
  return { head: git("rev-parse", "HEAD").trim(), included, differences, deferrals, errors, ok: !errors.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const [source, decisions] = process.argv.slice(2);
    if (!source) throw new Error("Usage: node --import tsx scripts/release-scope-audit.ts RELEASE_SOURCE [DEFERRALS.json]");
    const deferrals: unknown = decisions ? JSON.parse(readFileSync(decisions, "utf8")) : [];
    if (!Array.isArray(deferrals)) throw new Error("Deferrals must be a JSON array");
    const report = auditReleaseScope(process.cwd(), source, deferrals);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
