import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { auditReleaseScope } from "./release-scope-audit";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "release-scope-")); roots.push(root);
  const repo = path.join(root, "repo"), source = path.join(root, "source");
  mkdirSync(repo); mkdirSync(source);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
  git("init"); git("config", "user.name", "Release Test"); git("config", "user.email", "release@example.invalid");
  writeFileSync(path.join(repo, "view.ts"), "old");
  writeFileSync(path.join(source, "view.ts"), "old");
  git("add", "view.ts"); git("commit", "-m", "baseline");
  return { repo, source, git };
}
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
describe("release scope completeness", () => {
  it("runs and fails closed when the CLI is invoked through a symlink such as macOS /tmp", () => {
    const { repo, source } = fixture();
    writeFileSync(path.join(repo, "view.ts"), "missing release change");
    const entry = path.join(path.dirname(repo), "audit.ts");
    symlinkSync(fileURLToPath(new URL("./release-scope-audit.ts", import.meta.url)), entry);
    const result = spawnSync(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), entry, source], { cwd: repo, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, differences: [{ path: "view.ts" }] });
  });
  it("blocks a locally tested feature omitted from the build source, including untracked files", () => {
    const { repo, source } = fixture();
    writeFileSync(path.join(repo, "view.ts"), "new gesture hook");
    writeFileSync(path.join(repo, "gesture.ts"), "new gesture implementation");
    const report = auditReleaseScope(repo, source);
    expect(report.ok).toBe(false);
    expect(report.differences.map(item => item.path)).toEqual(["gesture.ts", "view.ts"]);
  });
  it("includes matching changes, including staged files", () => {
    const { repo, source, git } = fixture();
    for (const dir of [repo, source]) writeFileSync(path.join(dir, "view.ts"), "new");
    git("add", "view.ts");
    expect(auditReleaseScope(repo, source)).toMatchObject({ ok: true, included: ["view.ts"], differences: [] });
  });
  it("allows a documented partial file only for the exact reviewed pair of contents", () => {
    const { repo, source } = fixture();
    writeFileSync(path.join(repo, "view.ts"), "gestures plus unfinished cloud work");
    writeFileSync(path.join(source, "view.ts"), "gestures only");
    const decisions = auditReleaseScope(repo, source).differences.map(diff => ({ ...diff, reason: "Cloud workflow not yet validated; see release QA" }));
    expect(auditReleaseScope(repo, source, decisions).ok).toBe(true);
    writeFileSync(path.join(source, "view.ts"), "different release");
    expect(auditReleaseScope(repo, source, decisions).errors).toContain("Stale deferral: view.ts");
  });
  it("invalidates an exception when another session edits the working file", () => {
    const { repo, source } = fixture();
    writeFileSync(path.join(repo, "view.ts"), "pending");
    const decisions = auditReleaseScope(repo, source).differences.map(diff => ({ ...diff, reason: "Pending review" }));
    writeFileSync(path.join(repo, "view.ts"), "another edit");
    expect(auditReleaseScope(repo, source, decisions).ok).toBe(false);
  });
  it("detects deletions and rejects stale/duplicate/empty decisions", () => {
    const { repo, source } = fixture(); rmSync(path.join(repo, "view.ts"));
    const [diff] = auditReleaseScope(repo, source).differences;
    expect(diff.workspaceHash).toBeNull();
    expect(auditReleaseScope(repo, source, [{ ...diff, reason: "" }]).ok).toBe(false);
    const decision = { ...diff, reason: "Retained for compatibility" };
    expect(auditReleaseScope(repo, source, [decision, decision]).ok).toBe(false);
    rmSync(path.join(source, "view.ts"));
    expect(auditReleaseScope(repo, source, [decision]).errors).toContain("Stale deferral: view.ts");
  });
  it("does not read ignored credentials or allow checking the workspace against itself", () => {
    const { repo, source } = fixture();
    writeFileSync(path.join(repo, ".gitignore"), ".env\n");
    writeFileSync(path.join(source, ".gitignore"), ".env\n");
    writeFileSync(path.join(repo, ".env"), "TEST_ONLY_SECRET=not-a-real-credential");
    expect(auditReleaseScope(repo, source).ok).toBe(true);
    expect(() => auditReleaseScope(repo, repo)).toThrow("independent snapshot");
  });
  it("refuses ignored executable source instead of silently leaving it out of the seal", () => {
    const { repo, source } = fixture();
    for (const dir of [repo, source]) {
      writeFileSync(path.join(dir, ".gitignore"), "hidden.ts\n.env\n");
      writeFileSync(path.join(dir, "hidden.ts"), "unreviewed build input");
    }
    expect(auditReleaseScope(repo, source)).toMatchObject({ ok: false });
  });
  it("rejects source files and parent directories replaced by symlinks", () => {
    const { repo, source, git } = fixture();
    for (const dir of [repo, source]) {
      mkdirSync(path.join(dir, "server"));
      writeFileSync(path.join(dir, "server/input.ts"), "same");
    }
    git("add", "server"); git("commit", "-m", "add server");
    rmSync(path.join(source, "server"), { recursive: true });
    symlinkSync(path.join(repo, "server"), path.join(source, "server"));
    expect(() => auditReleaseScope(repo, source)).toThrow(/symlink/i);
  });
});
