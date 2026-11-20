/** Bind the reviewed source and built artifacts. No network or deployment side effects. */
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { auditReleaseInventory, digest } from "./release-inventory-audit";
import { hashFile } from "./release-scope-audit";

type Inventory = ReturnType<typeof auditReleaseInventory>;
function artifacts(root: string, prefix = ""): { path: string; hash: string | null }[] {
  return readdirSync(path.join(root, prefix)).sort().flatMap(name => {
    const file = path.join(prefix, name), stat = lstatSync(path.join(root, file));
    if (stat.isSymbolicLink()) throw new Error(`Artifact symlinks are not allowed: ${file}`);
    return stat.isDirectory() ? artifacts(root, file) : [{ path: file, hash: hashFile(path.join(root, file)) }];
  });
}
export function sealRelease(report: Inventory) {
  if (!report.ok || report.errors.length) throw new Error("Cannot seal an unreviewed release");
  const current = auditReleaseInventory(report.repo, report.source, report.decisions);
  if (!current.ok || digest(current) !== digest(report)) throw new Error("Source or worktree inventory changed; rerun release audit");
  const built = artifacts(path.join(report.source, "dist"));
  if (!built.some(f => f.path === "index.js") || !built.some(f => f.path === "public/index.html")) throw new Error("Incomplete build: server and frontend required");
  // Python workers are executed outside the JS bundle and must travel with it.
  const mediaSupport = [
    "scripts/cut-word-timing.py", "scripts/dialogue-cup-onset.py",
    "scripts/read-picture-region.swift", "scripts/read-video-text.swift",
    ...["fire","wood","earth","water","metal"].map(kind => `docs/prototypes/liaohuier-miniapp/assets/cup-${kind}.png`),
  ];
  const support = report.files.filter(f => f.hash !== null && (
    mediaSupport.includes(f.path) || (f.path.startsWith("scripts/frame-regions/") && /\.(py|txt)$/.test(f.path))
  ));
  const files = [...built.map(f => ({ ...f, path: `dist/${f.path}` })), ...support].sort((a, b) => a.path.localeCompare(b.path));
  return { schemaVersion: 1 as const, sourceKind: report.sourceKind, primaryHead: report.head, sourceDigest: report.sourceDigest, inventoryDigest: digest(report), artifacts: files };
}
export function verifyRelease(report: Inventory, sealed: ReturnType<typeof sealRelease>) {
  const current = sealRelease(report);
  if (digest(current) !== digest(sealed)) throw new Error("Sealed release changed; do not upload");
  return { ok: true, primaryHead: current.primaryHead, sourceKind: current.sourceKind, sourceDigest: current.sourceDigest, artifacts: current.artifacts.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const [mode, reportPath, manifestPath] = process.argv.slice(2);
    if (!reportPath || (mode !== "seal" && mode !== "verify") || (mode === "verify" && !manifestPath)) throw new Error("Usage: release-artifacts.ts seal AUDIT.json | verify AUDIT.json MANIFEST.json");
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    console.log(JSON.stringify(mode === "seal" ? sealRelease(report) : verifyRelease(report, JSON.parse(readFileSync(manifestPath, "utf8"))), null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
