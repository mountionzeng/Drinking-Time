import { beforeEach, describe, expect, it } from "vitest";
import { resetMemoryStateForTesting, seedStoryForTesting } from "../db";
import {
  loadStorySoundWorkspace,
  saveStorySoundPlanVersion,
  saveStorySoundWorkspace,
  restoreStorySoundPlanVersionToWorkspace,
} from "./storySoundPlanStore";

const draft = (direction: string) => ({
  globalDirection: direction,
  rows: [],
  characterVoiceAssignments: [],
});

describe("storySoundPlanStore", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
    seedStoryForTesting({ id: 11, userId: 1 });
  });

  it("enforces ownership and optimistic workspace revisions", async () => {
    const first = await saveStorySoundWorkspace({
      storyId: 11,
      userId: 1,
      expectedRevision: 0,
      draft: draft("quiet"),
      interviewStatus: "draft",
      selectionByRowId: {},
    });
    expect(first.status).toBe("ok");
    const stale = await saveStorySoundWorkspace({
      storyId: 11,
      userId: 1,
      expectedRevision: 0,
      draft: draft("loud"),
      interviewStatus: "draft",
      selectionByRowId: {},
    });
    expect(stale).toMatchObject({ status: "conflict", revision: 1 });
    expect(
      await loadStorySoundWorkspace({ storyId: 11, userId: 2 })
    ).toBeNull();
  });

  it("deduplicates content-addressed versions and restores into the draft only", async () => {
    await saveStorySoundWorkspace({
      storyId: 11,
      userId: 1,
      expectedRevision: 0,
      draft: draft("v1"),
      interviewStatus: "draft",
      selectionByRowId: {},
    });
    const one = await saveStorySoundPlanVersion({
      storyId: 11,
      userId: 1,
      evidenceSnapshotDigest: "e1",
      sourceRevisions: {},
    });
    const duplicate = await saveStorySoundPlanVersion({
      storyId: 11,
      userId: 1,
      evidenceSnapshotDigest: "e1",
      sourceRevisions: {},
    });
    expect(duplicate.id).toBe(one.id);
    await saveStorySoundWorkspace({
      storyId: 11,
      userId: 1,
      expectedRevision: 1,
      draft: draft("v2"),
      interviewStatus: "draft",
      selectionByRowId: {},
    });
    const two = await saveStorySoundPlanVersion({
      storyId: 11,
      userId: 1,
      evidenceSnapshotDigest: "e1",
      sourceRevisions: {},
    });
    expect(two.versionNumber).toBe(2);
    const restored = await restoreStorySoundPlanVersionToWorkspace({
      storyId: 11,
      userId: 1,
      versionId: one.id,
      expectedRevision: 2,
    });
    expect(restored.status).toBe("ok");
    expect(restored.status === "ok" && restored.workspace.globalDirection).toBe(
      "v1"
    );
    expect(two.globalDirection).toBe("v2");
  });
});
