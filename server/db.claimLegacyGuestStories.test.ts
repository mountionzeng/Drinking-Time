import { beforeEach, describe, expect, it } from "vitest";

import {
  claimGuestStories,
  claimLegacyGuestStories,
  createGeneratedImage,
  createShots,
  createStory,
  getGeneratedImageById,
  getLocalPromptLineageState,
  getOrCreateUserDefaultProject,
  getStoryById,
  getStoryTimeline,
  getUserByOpenId,
  listUserStories,
  replaceLocalPromptLineageState,
  resetMemoryStateForTesting,
  updateStoryTimeline,
  upsertUser,
} from "./db";
import { createEmptyPromptLineageLocalState } from "../shared/promptLineage";

describe("claimLegacyGuestStories", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "";
    resetMemoryStateForTesting();
  });

  it("把旧 local-guest 的故事与关联故事数据迁到目标用户", async () => {
    await upsertUser({
      openId: "local-guest",
      name: "Legacy Guest",
      loginMethod: "guest",
      lastSignedIn: new Date("2026-07-01T10:00:00.000Z"),
    });
    await upsertUser({
      openId: "guest:target-browser",
      name: "Target Browser",
      loginMethod: "guest",
      lastSignedIn: new Date("2026-07-01T10:05:00.000Z"),
    });

    const legacyUser = await getUserByOpenId("local-guest");
    const targetUser = await getUserByOpenId("guest:target-browser");
    expect(legacyUser).toBeDefined();
    expect(targetUser).toBeDefined();

    const legacyProject = await getOrCreateUserDefaultProject(legacyUser!.id);
    const story = await createStory({
      userId: legacyUser!.id,
      projectId: legacyProject.id,
      title: "旧共享故事",
      body: {
        cards: [],
        characters: [],
        shots: [],
      },
    });

    await createShots([
      {
        projectId: legacyProject.id,
        storyId: story.id,
        userId: legacyUser!.id,
        sceneNo: "1",
        shotNo: "SH01",
      },
    ]);

    const image = await createGeneratedImage({
      projectId: legacyProject.id,
      storyId: story.id,
      userId: legacyUser!.id,
      shotNo: "SH01",
      shotIdentity: "shot-1",
      imageUrl: "https://example.com/legacy.png",
      prompt: "旧图",
      isCurrent: true,
    });

    await updateStoryTimeline({
      storyId: story.id,
      userId: legacyUser!.id,
      expectedVersion: 0,
      items: [{ id: "timeline-1", stableShotId: "shot-1" }],
    });

    const promptLineage = createEmptyPromptLineageLocalState();
    promptLineage.storyStates.push({
      id: 1,
      storyId: story.id,
      userId: legacyUser!.id,
      version: 1,
      migrationStatus: "migrated",
      migratedAt: null,
      createdAt: "2026-07-01T10:00:00.000Z",
      updatedAt: "2026-07-01T10:00:00.000Z",
    });
    promptLineage.nodes.push({
      id: 1,
      storyId: story.id,
      userId: legacyUser!.id,
      stableShotId: "shot-1",
      scope: "shot",
      modality: "image",
      dimension: "subject",
      currentRevisionId: 1,
      createdAt: "2026-07-01T10:00:00.000Z",
      updatedAt: "2026-07-01T10:00:00.000Z",
    });
    promptLineage.revisions.push({
      id: 1,
      storyId: story.id,
      userId: legacyUser!.id,
      nodeId: 1,
      parentRevisionId: null,
      content: "旧共享提示词",
      weight: 0.6,
      authorType: "user",
      authorUserId: legacyUser!.id,
      reason: null,
      source: null,
      status: "confirmed",
      createdAt: "2026-07-01T10:00:00.000Z",
      decidedAt: null,
    });
    promptLineage.compilations.push({
      id: 1,
      storyId: story.id,
      userId: legacyUser!.id,
      stableShotId: "shot-1",
      modality: "image",
      finalText: "最终提示词",
      inputFingerprint: "fingerprint",
      createdAt: "2026-07-01T10:00:00.000Z",
    });
    promptLineage.compilationHeads.push({
      id: 1,
      storyId: story.id,
      userId: legacyUser!.id,
      stableShotId: "shot-1",
      modality: "image",
      currentCompilationId: 1,
      updatedAt: "2026-07-01T10:00:00.000Z",
    });
    await replaceLocalPromptLineageState(promptLineage);

    const result = await claimLegacyGuestStories(targetUser!.id);

    expect(result.reason).toBe("claimed");
    expect(result.migratedStoryCount).toBe(1);

    const targetProject = await getOrCreateUserDefaultProject(targetUser!.id);
    const claimedStory = await getStoryById(story.id, targetUser!.id);
    expect(claimedStory?.projectId).toBe(targetProject.id);
    expect(await getStoryById(story.id, legacyUser!.id)).toBeNull();
    expect(await listUserStories(legacyUser!.id)).toHaveLength(0);
    expect(await listUserStories(targetUser!.id)).toHaveLength(1);

    const claimedImage = await getGeneratedImageById(image.id);
    expect(claimedImage?.userId).toBe(targetUser!.id);
    expect(claimedImage?.projectId).toBe(targetProject.id);

    const claimedTimeline = await getStoryTimeline(story.id, targetUser!.id);
    expect(claimedTimeline?.userId).toBe(targetUser!.id);

    const nextPromptLineage = await getLocalPromptLineageState();
    expect(nextPromptLineage?.storyStates[0]?.userId).toBe(targetUser!.id);
    expect(nextPromptLineage?.revisions[0]?.userId).toBe(targetUser!.id);
    expect(nextPromptLineage?.revisions[0]?.authorUserId).toBe(targetUser!.id);
  });

  it("没有 legacy user 时返回 no_legacy_user", async () => {
    await upsertUser({
      openId: "guest:target-browser",
      name: "Target Browser",
      loginMethod: "guest",
      lastSignedIn: new Date("2026-07-01T10:05:00.000Z"),
    });
    const targetUser = await getUserByOpenId("guest:target-browser");

    const result = await claimLegacyGuestStories(targetUser!.id);

    expect(result.reason).toBe("no_legacy_user");
    expect(result.migratedStoryCount).toBe(0);
  });

  it("可以显式认领被错误分配给临时 guest 的故事", async () => {
    await upsertUser({
      openId: "guest:source-browser",
      name: "Source Browser",
      loginMethod: "guest",
    });
    await upsertUser({
      openId: "guest:target-browser",
      name: "Target Browser",
      loginMethod: "guest",
    });
    const sourceUser = await getUserByOpenId("guest:source-browser");
    const targetUser = await getUserByOpenId("guest:target-browser");
    const sourceProject = await getOrCreateUserDefaultProject(sourceUser!.id);
    const story = await createStory({
      userId: sourceUser!.id,
      projectId: sourceProject.id,
      title: "错误分配的故事",
      body: { cards: [], characters: [], shots: [] },
    });

    const result = await claimGuestStories(sourceUser!.id, targetUser!.id);

    expect(result.reason).toBe("claimed");
    expect(await getStoryById(story.id, targetUser!.id)).not.toBeNull();
    expect(await getStoryById(story.id, sourceUser!.id)).toBeNull();
  });
});
