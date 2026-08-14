import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

export default async function setupVitestTempRoot() {
  const testRunPersistRoot = await mkdtemp(
    path.join(os.tmpdir(), "drinking-time-vitest-run-")
  );

  process.env.DRINKING_TIME_VITEST_TEMP_ROOT = testRunPersistRoot;

  return async () => {
    await rm(testRunPersistRoot, { recursive: true, force: true });
    delete process.env.DRINKING_TIME_VITEST_TEMP_ROOT;
  };
}
