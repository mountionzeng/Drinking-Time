import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { auditReleaseInventory, type ReleaseDecisions } from "./release-inventory-audit";
import { sealRelease, verifyRelease } from "./release-artifacts";

const roots: string[] = [];
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "release-inventory-")); roots.push(root);
  const repo = path.join(root, "repo"), source = path.join(root, "source"), tree = path.join(root, "other");
  for (const dir of [repo, source]) { mkdirSync(dir); writeFileSync(path.join(dir, "view.ts"), "original"); writeFileSync(path.join(dir, ".gitignore"), "dist/\n.env\n"); }
  git(repo, "init"); git(repo, "config", "user.name", "Test"); git(repo, "config", "user.email", "test@example.invalid"); git(repo, "add", "."); git(repo, "commit", "-m", "initial");
  git(repo, "worktree", "add", "-b", "feature", tree);
  return { repo, source, tree };
}
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
it("detects clean committed files omitted from a build and unexpected source files", () => {
  const { repo, source } = fixture();
  writeFileSync(path.join(source, "view.ts"), "old build");
  writeFileSync(path.join(source, "unexpected.ts"), "unreviewed");
  const report = auditReleaseInventory(repo, source);
  expect(report.ok).toBe(false);
  expect(report.primary.differences.map(d => d.path)).toEqual(["unexpected.ts", "view.ts"]);
});
it("detects committed and uncommitted changes in another worktree, ignoring credentials", () => {
  const { repo, source, tree } = fixture();
  writeFileSync(path.join(tree, "view.ts"), "feature"); git(tree, "add", "view.ts"); git(tree, "commit", "-m", "feature");
  writeFileSync(path.join(tree, "draft.ts"), "unfinished"); writeFileSync(path.join(tree, ".env"), "SECRET=test-only");
  const report = auditReleaseInventory(repo, source);
  expect(report.ok).toBe(false);
  expect(report.worktrees[0].commits).toHaveLength(1);
  expect(report.worktrees[0].differences.map(d => d.path)).toEqual(["draft.ts", "view.ts"]);
});
it("requires an exact reviewed fingerprint and invalidates it when a tree changes", () => {
  const { repo, source, tree } = fixture(); writeFileSync(path.join(tree, "view.ts"), "draft");
  const initial = auditReleaseInventory(repo, source);
  const decisions: ReleaseDecisions = { primary: [], worktrees: initial.worktrees.map(t => ({ path: t.path, fingerprint: t.fingerprint, reason: "Superseded implementation; reviewed against current feature" })) };
  expect(auditReleaseInventory(repo, source, decisions).ok).toBe(true);
  writeFileSync(path.join(tree, "view.ts"), "new draft");
  expect(auditReleaseInventory(repo, source, decisions).ok).toBe(false);
});
it("does not falsely flag equivalent feature commits or an unchanged ancestor", () => {
  const { repo, source, tree } = fixture(); expect(auditReleaseInventory(repo, source).ok).toBe(true);
  for (const dir of [repo, source, tree]) writeFileSync(path.join(dir, "view.ts"), "same feature");
  git(tree, "add", "view.ts"); git(tree, "commit", "-m", "feature on branch");
  git(repo, "add", "view.ts"); git(repo, "commit", "-m", "equivalent integration");
  expect(auditReleaseInventory(repo, source).ok).toBe(true);
});
it("requires a decision for a registered worktree whose directory is missing", () => {
  const { repo, source, tree } = fixture(); rmSync(tree, { recursive: true });
  expect(auditReleaseInventory(repo, source)).toMatchObject({ ok: false, worktrees: [{ missing: true, needsReview: true }] });
});
it("seals complete builds and rejects post-test source, tree or artifact drift", () => {
  const { repo, source, tree } = fixture();
  mkdirSync(path.join(source, "dist/public"), { recursive: true });
  writeFileSync(path.join(source, "dist/index.js"), "server"); writeFileSync(path.join(source, "dist/public/index.html"), "client");
  const report = auditReleaseInventory(repo, source), sealed = sealRelease(report);
  expect(verifyRelease(report, sealed).ok).toBe(true);
  writeFileSync(path.join(source, "dist/index.js"), "other server");
  expect(() => verifyRelease(report, sealed)).toThrow("Sealed release changed");
  writeFileSync(path.join(source, "dist/index.js"), "server");
  writeFileSync(path.join(source, "view.ts"), "changed after tests");
  expect(() => verifyRelease(report, sealed)).toThrow("inventory changed");
  writeFileSync(path.join(source, "view.ts"), "original"); writeFileSync(path.join(tree, "draft.ts"), "new unfinished feature");
  expect(() => verifyRelease(report, sealed)).toThrow("inventory changed");
});
it("rejects failed audits and incomplete builds", () => {
  const { repo, source } = fixture(); const report = auditReleaseInventory(repo, source);
  mkdirSync(path.join(source, "dist")); writeFileSync(path.join(source, "dist/index.js"), "server only");
  expect(() => sealRelease(report)).toThrow("Incomplete build");
  expect(() => sealRelease({ ...report, ok: false })).toThrow("unreviewed");
});
it("binds the main HEAD and explicitly labels independent source as a snapshot", () => {
  const { repo, source } = fixture();
  const report = auditReleaseInventory(repo, source);
  expect(report).toMatchObject({ sourceKind: "snapshot" });
  mkdirSync(path.join(source, "dist/public"), { recursive: true });
  writeFileSync(path.join(source, "dist/index.js"), "server");
  writeFileSync(path.join(source, "dist/public/index.html"), "client");
  const sealed = sealRelease(report);
  expect(sealed).toMatchObject({ sourceKind: "snapshot", primaryHead: report.head });
  git(repo, "commit", "--allow-empty", "-m", "main moved during build");
  expect(() => verifyRelease(report, sealed)).toThrow("inventory changed");
});
