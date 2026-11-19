/** The production build entry point. Audit first, build the exact snapshot, seal last. */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { auditReleaseInventory, digest } from "./release-inventory-audit";
import { sealRelease } from "./release-artifacts";

try {
  const [reportPath, manifestPath] = process.argv.slice(2);
  if (!reportPath || !manifestPath) throw new Error("Usage: release-build.ts AUDIT.json MANIFEST.json");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const current = auditReleaseInventory(report.repo, report.source, report.decisions);
  if (!report.ok || !current.ok || digest(report) !== digest(current)) throw new Error("Release inventory changed or is not approved; build refused");
  const result = spawnSync("pnpm", ["build"], { cwd: report.source, stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error(`Build failed: ${result.error?.message ?? result.status}`);
  writeFileSync(manifestPath, JSON.stringify(sealRelease(report), null, 2) + "\n");
  console.log("Release sealed. Run release:verify again immediately before upload.");
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
