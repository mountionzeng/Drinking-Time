import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteStory,
  listStorySoundRowOperationRecords,
  resetMemoryStateForTesting,
  restoreStorySoundDirectorStateForTesting,
  seedStoryForTesting,
  serializeStorySoundDirectorStateForTesting,
} from "./db";
import {
  getOrCreateStorySoundRowOperation,
  listStorySoundPlanVersions,
  loadStorySoundWorkspace,
  saveStorySoundPlanVersion,
  saveStorySoundWorkspace,
} from "./services/storySoundPlanStore";
import {
  getOrCreateVoiceActivationOperation,
  loadStoryVoiceProfile,
  saveStoryVoiceProfile,
} from "./services/storyVoiceProfiles";

const draft = {
  globalDirection: "真实故事",
  rows: [],
  characterVoiceAssignments: [],
};
async function seedFacts() {
  seedStoryForTesting({ id: 31, userId: 3 });
  await saveStorySoundWorkspace({
    storyId: 31,
    userId: 3,
    expectedRevision: 0,
    draft,
    interviewStatus: "draft",
    selectionByRowId: {},
  });
  const version = await saveStorySoundPlanVersion({
    storyId: 31,
    userId: 3,
    evidenceSnapshotDigest: "evidence",
    sourceRevisions: { story: "r1" },
  });
  const operation = await getOrCreateStorySoundRowOperation({
    storyId: 31,
    userId: 3,
    rowId: "row-1",
    versionId: version.id,
    requestDigest: "request",
    quoteId: "quote",
    amountMinorUnits: 100,
    currency: "CNY",
  });
  await saveStoryVoiceProfile({
    id: "voice-user-3",
    userId: 3,
    displayName: "本人",
    subject: "self",
    rightsBasis: "self_voice",
    assuranceLevel: "fresh_liveness",
    allowedUseScope: "all_owned_stories",
    activation: { status: "active", priceVersion: "p1" },
    status: "active",
  });
  await getOrCreateVoiceActivationOperation({
    userId: 3,
    profileId: "voice-user-3",
    provider: "doubao",
    priceVersion: "p1",
    requestDigest: "activation-request",
  });
  return operation;
}

describe("story sound director local persistence parity", () => {
  beforeEach(() => resetMemoryStateForTesting());

  it("tombstones charged receipts on Story deletion while preserving reusable voice profiles", async () => {
    const operation = await seedFacts();
    await deleteStory(31, 3);
    expect(
      await loadStorySoundWorkspace({ storyId: 31, userId: 3 })
    ).toBeNull();
    expect(
      await listStorySoundPlanVersions({ storyId: 31, userId: 3 })
    ).toEqual([]);
    const receipts = await listStorySoundRowOperationRecords({
      storyIdSnapshot: 31,
      userId: 3,
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      publicId: operation.id,
      storyId: null,
      storyIdSnapshot: 31,
      amountMinorUnits: 100,
    });
    expect(receipts[0].tombstonedAt).toBeInstanceOf(Date);
    expect(
      await loadStoryVoiceProfile({ id: "voice-user-3", userId: 3 })
    ).not.toBeNull();
  });

  it("resets all collections and id allocators without collisions", async () => {
    const first = await seedFacts();
    resetMemoryStateForTesting();
    const second = await seedFacts();
    expect(second.id).toBe(first.id);
    const replay = await getOrCreateStorySoundRowOperation({
      storyId: 31,
      userId: 3,
      rowId: "row-1",
      versionId: (
        await listStorySoundPlanVersions({ storyId: 31, userId: 3 })
      )[0].id,
      requestDigest: "request",
      quoteId: "quote",
      amountMinorUnits: 100,
      currency: "CNY",
    });
    expect(replay.id).toBe(second.id);
  });

  it("round-trips every sound-director collection through local JSON", async () => {
    await seedFacts();
    const serialized = serializeStorySoundDirectorStateForTesting();
    resetMemoryStateForTesting();
    restoreStorySoundDirectorStateForTesting(serialized);
    expect(
      (await loadStorySoundWorkspace({ storyId: 31, userId: 3 }))?.revision
    ).toBe(1);
    expect(
      await listStorySoundPlanVersions({ storyId: 31, userId: 3 })
    ).toHaveLength(1);
    expect(
      await listStorySoundRowOperationRecords({
        storyIdSnapshot: 31,
        userId: 3,
      })
    ).toHaveLength(1);
    expect(
      await loadStoryVoiceProfile({ id: "voice-user-3", userId: 3 })
    ).not.toBeNull();
  });
});
