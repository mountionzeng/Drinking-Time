import { mkdtempSync } from "node:fs";
import path from "node:path";

const testRunPersistRoot = process.env.DRINKING_TIME_VITEST_TEMP_ROOT;

if (!testRunPersistRoot) {
  throw new Error("Vitest temporary root was not initialized by global setup");
}

const isolatedPersistDir = mkdtempSync(
  path.join(testRunPersistRoot, "test-file-")
);

process.env.LOCAL_PERSIST_PATH = path.join(
  isolatedPersistDir,
  "local-persist.json"
);
