import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createEmptyPromptLineageLocalState } from "../shared/promptLineage";

const previousPaths = {
  databaseUrl: process.env.DATABASE_URL,
  localPersist: process.env.LOCAL_PERSIST_PATH,
  promptLineage: process.env.LOCAL_PROMPT_LINEAGE_PATH,
  editSnapshots: process.env.LOCAL_EDIT_SNAPSHOTS_PATH,
};
const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-local-sidecars-"));
process.env.DATABASE_URL = "";
process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");
process.env.LOCAL_PROMPT_LINEAGE_PATH = path.join(
  tempDir,
  "prompt-lineage-local.json"
);
process.env.LOCAL_EDIT_SNAPSHOTS_PATH = path.join(
  tempDir,
  "edit-snapshots-local.json"
);

const db = await import("./db");

describe("local persistence sidecar files", () => {
  afterAll(async () => {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore("DATABASE_URL", previousPaths.databaseUrl);
    restore("LOCAL_PERSIST_PATH", previousPaths.localPersist);
    restore("LOCAL_PROMPT_LINEAGE_PATH", previousPaths.promptLineage);
    restore("LOCAL_EDIT_SNAPSHOTS_PATH", previousPaths.editSnapshots);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("keeps prompt lineage and edit snapshots out of the main story file", async () => {
    const { id: storyId } = await db.createStory({
      userId: 7,
      projectId: 3,
      title: "侧车测试故事",
      body: { cards: [], characters: [], shots: [] },
    });

    const lineage = createEmptyPromptLineageLocalState();
    lineage.storyStates.push({
      id: 1,
      storyId,
      userId: 7,
      version: 1,
      migrationStatus: "migrated",
      migratedAt: null,
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z",
    });
    await db.replaceLocalPromptLineageState(lineage);
    await db.createEditSnapshot({
      projectId: 3,
      sessionId: "session-1",
      state: { title: "snapshot" },
      previousSnapshotId: null,
      diff: null,
    });
    await db.updateStory(storyId, 7, {
      body: { cards: [], characters: [], shots: [{ shotNo: 1 }] },
    });

    const main = JSON.parse(
      await readFile(process.env.LOCAL_PERSIST_PATH!, "utf-8")
    );
    const sidecarLineage = JSON.parse(
      await readFile(process.env.LOCAL_PROMPT_LINEAGE_PATH!, "utf-8")
    );
    const sidecarSnapshots = JSON.parse(
      await readFile(process.env.LOCAL_EDIT_SNAPSHOTS_PATH!, "utf-8")
    );

    expect(main.promptLineage).toBeUndefined();
    expect(main.editSnapshots).toBeUndefined();
    expect(main.stories).toHaveLength(1);
    expect(sidecarLineage.storyStates).toHaveLength(1);
    expect(sidecarSnapshots).toHaveLength(1);
  });
});
