import { mkdtempSync } from "node:fs";
import path from "node:path";

const testRunPersistRoot = process.env.DRINKING_TIME_VITEST_TEMP_ROOT;

if (!testRunPersistRoot) {
  throw new Error("Vitest temporary root was not initialized by global setup");
}

const isolatedPersistDir = mkdtempSync(
  path.join(testRunPersistRoot, "test-file-"),
);

process.env.LOCAL_PERSIST_PATH = path.join(
  isolatedPersistDir,
  "local-persist.json",
);
// Preview environments may supply these paths in .env. Tests must never inherit
// the running editor's lineage, snapshots or media directories.
// Empty overrides block dotenv while letting tests derive sidecars from their
// own LOCAL_PERSIST_PATH (including compatibility fixtures that change it).
process.env.LOCAL_PROMPT_LINEAGE_PATH = "";
process.env.LOCAL_EDIT_SNAPSHOTS_PATH = "";
process.env.LOCAL_IMAGE_DIR = path.join(isolatedPersistDir, "images");
process.env.CHAPTER_MEDIA_DIR = path.join(isolatedPersistDir, "chapter-media");
