import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getStoryById: vi.fn(),
  updateStory: vi.fn(),
  updateStoryBodyIfRevision: vi.fn(),
}));

vi.mock("../db", () => dbMocks);

import {
  PublishingDraftConflictError,
  PublishingDraftOwnershipError,
  getPublishingDraftState,
  writePublishingDraftState,
} from "./publishingPersistence";

const baseCore = {
  facts: ["事实"],
  thesis: "判断",
  emotion: "克制",
  voiceTraits: ["直接"],
  visualConcept: "一个居中的人物",
};

describe("publishingPersistence", () => {
  let story: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    story = {
      id: 7,
      userId: 3,
      title: "Story",
      body: { cards: [], shots: [], _revision: 2 },
    };
    dbMocks.getStoryById.mockImplementation(
      async (id: number, userId: number) =>
        id === story.id && userId === story.userId
          ? structuredClone(story)
          : null
    );
    dbMocks.updateStory.mockImplementation(
      async (id: number, userId: number, patch: Record<string, unknown>) => {
        if (id === story.id && userId === story.userId) {
          story = { ...story, ...structuredClone(patch) };
        }
      }
    );
    dbMocks.updateStoryBodyIfRevision.mockImplementation(
      async (input: {
        id: number;
        userId: number;
        expectedRevision: number;
        body: Record<string, unknown>;
      }) => {
        const currentRevision =
          ((story.body as Record<string, unknown>)._revision as number) ?? 0;
        if (
          input.id !== story.id ||
          input.userId !== story.userId ||
          input.expectedRevision !== currentRevision
        ) {
          return false;
        }
        story = { ...story, body: structuredClone(input.body) };
        return true;
      }
    );
  });

  it("initializes a core and only the requested active platform", async () => {
    const saved = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "initialize",
        activePlatform: "xiaohongshu",
        selectedPlatforms: ["xiaohongshu", "x", "linkedin"],
        core: baseCore,
        content: { title: "标题", body: "当前平台正文", tags: ["AI"] },
        basePublishingRevision: 0,
      },
    });

    expect(saved.storyRevision).toBe(3);
    expect(saved.publishing.core?.revision).toBe(1);
    expect(saved.publishing.selectedPlatforms).toEqual([
      "xiaohongshu",
      "x",
      "linkedin",
    ]);
    expect(Object.keys(saved.publishing.drafts)).toEqual(["xiaohongshu"]);
  });

  it("serializes disjoint platform writes so both survive", async () => {
    await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "initialize",
        activePlatform: "xiaohongshu",
        selectedPlatforms: ["xiaohongshu", "x", "instagram"],
        core: baseCore,
        content: { title: "", body: "source", tags: [] },
        basePublishingRevision: 0,
      },
    });

    await Promise.all([
      writePublishingDraftState({
        storyId: 7,
        userId: 3,
        operation: {
          type: "upsert_draft",
          platform: "x",
          content: { title: "", body: "X", tags: [] },
          baseDraftRevision: 0,
        },
      }),
      writePublishingDraftState({
        storyId: 7,
        userId: 3,
        operation: {
          type: "upsert_draft",
          platform: "instagram",
          content: { title: "", body: "IG", tags: [] },
          baseDraftRevision: 0,
        },
      }),
    ]);

    const saved = await getPublishingDraftState(7, 3);
    expect(saved.publishing.drafts.x?.content.body).toBe("X");
    expect(saved.publishing.drafts.instagram?.content.body).toBe("IG");
  });

  it("rejects a stale same-platform edit and preserves the server draft", async () => {
    await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "initialize",
        activePlatform: "x",
        selectedPlatforms: ["x"],
        core: baseCore,
        content: { title: "", body: "server", tags: [] },
        basePublishingRevision: 0,
      },
    });

    await expect(
      writePublishingDraftState({
        storyId: 7,
        userId: 3,
        operation: {
          type: "apply_wording",
          platform: "x",
          content: { title: "", body: "stale overwrite", tags: [] },
          baseDraftRevision: 0,
        },
      })
    ).rejects.toBeInstanceOf(PublishingDraftConflictError);

    expect(
      (await getPublishingDraftState(7, 3)).publishing.drafts.x?.content.body
    ).toBe("server");
  });

  it("advances a confirmed core and marks other drafts without rewriting them", async () => {
    await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "initialize",
        activePlatform: "xiaohongshu",
        selectedPlatforms: ["xiaohongshu", "x"],
        core: baseCore,
        content: { title: "", body: "小红书", tags: [] },
        basePublishingRevision: 0,
      },
    });
    await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "upsert_draft",
        platform: "x",
        content: { title: "", body: "do not rewrite", tags: [] },
        baseDraftRevision: 0,
      },
    });

    const saved = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "confirm_core_change",
        platform: "xiaohongshu",
        core: { ...baseCore, thesis: "新的判断" },
        content: { title: "", body: "新的小红书稿", tags: [] },
        baseCoreRevision: 1,
        baseDraftRevision: 1,
      },
    });

    expect(saved.publishing.core?.revision).toBe(2);
    expect(saved.publishing.drafts.x?.needsReview).toBe(true);
    expect(saved.publishing.drafts.x?.content.body).toBe("do not rewrite");
  });

  it("appends a paid four-candidate cover round without changing the formal cover", async () => {
    const initialized = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "initialize",
        activePlatform: "xiaohongshu",
        selectedPlatforms: ["xiaohongshu"],
        core: baseCore,
        content: { title: "标题", body: "正文", tags: [] },
        basePublishingRevision: 0,
      },
    });
    const withCover = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "set_cover",
        cover: { assetId: 40, sourceCoreRevision: 1, createdAt: 100 },
        basePublishingRevision: initialized.publishing.revision,
      },
    });

    const saved = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "append_cover_round",
        round: {
          id: "round-1",
          platform: "xiaohongshu",
          sourceCoreRevision: 1,
          parentAssetId: null,
          feedback: "去掉字体，让人物更小",
          assetIds: [51, 52, 53, 54],
          createdAt: 200,
        },
        basePublishingRevision: withCover.publishing.revision,
      },
    });

    expect(saved.publishing.cover?.assetId).toBe(40);
    expect(saved.publishing.coverRounds).toEqual([
      expect.objectContaining({
        id: "round-1",
        assetIds: [51, 52, 53, 54],
      }),
    ]);

    await expect(
      writePublishingDraftState({
        storyId: 7,
        userId: 3,
        operation: {
          type: "append_cover_round",
          round: {
            id: "stale-round",
            platform: "xiaohongshu",
            sourceCoreRevision: 1,
            parentAssetId: null,
            feedback: "",
            assetIds: [61, 62, 63, 64],
            createdAt: 300,
          },
          basePublishingRevision: withCover.publishing.revision,
        },
      })
    ).rejects.toBeInstanceOf(PublishingDraftConflictError);
  });

  it("rejects another user's read and write before updating", async () => {
    await expect(getPublishingDraftState(7, 99)).rejects.toBeInstanceOf(
      PublishingDraftOwnershipError
    );
    await expect(
      writePublishingDraftState({
        storyId: 7,
        userId: 99,
        operation: {
          type: "initialize",
          activePlatform: "x",
          selectedPlatforms: ["x"],
          core: baseCore,
          content: { title: "", body: "no", tags: [] },
          basePublishingRevision: 0,
        },
      })
    ).rejects.toBeInstanceOf(PublishingDraftOwnershipError);
    expect(dbMocks.updateStoryBodyIfRevision).not.toHaveBeenCalled();
  });

  it("creates an isolated V2 with the confirmed platform, inherited cover, and review flags", async () => {
    const initialized = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "initialize",
        activePlatform: "xiaohongshu",
        selectedPlatforms: ["xiaohongshu", "x"],
        core: baseCore,
        content: { title: "V1 标题", body: "V1 小红书", tags: [] },
        basePublishingRevision: 0,
      },
    });
    const withX = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "upsert_draft",
        platform: "x",
        content: { title: "V1 X", body: "V1 X 正文", tags: [] },
        baseDraftRevision: 0,
      },
    });
    const withCover = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "set_cover",
        cover: { assetId: 77, sourceCoreRevision: 1, createdAt: 10 },
        basePublishingRevision: withX.publishing.revision,
      },
    });
    const withRound = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "append_cover_round",
        round: {
          id: "v1-round",
          platform: "xiaohongshu",
          sourceCoreRevision: 1,
          parentAssetId: null,
          feedback: "候选",
          assetIds: [81, 82, 83, 84],
          createdAt: 11,
        },
        basePublishingRevision: withCover.publishing.revision,
      },
    });

    const saved = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operationToken: "create-v2-once",
      operation: {
        type: "create_version",
        platform: "xiaohongshu",
        core: { ...baseCore, thesis: "V2 判断" },
        content: { title: "V2 标题", body: "V2 小红书", tags: ["V2"] },
        baseCoreRevision: 1,
        baseDraftRevision: 1,
        baseVersionRevision: withRound.publishing.versions?.find(
          v => v.versionId === "v1"
        )?.versionRevision,
        baseContainerRevision: withRound.publishing.containerRevision ?? 0,
        conversationSnapshot: {
          messages: [{ role: "user", content: "V2 想法" }],
          updatedAt: 12,
        },
      },
    });

    expect(saved.publishing.activeVersionId).toBe("v2");
    expect(saved.publishing.versions).toHaveLength(2);
    expect(saved.publishing.core?.thesis).toBe("V2 判断");
    expect(saved.publishing.drafts.xiaohongshu?.content.body).toBe("V2 小红书");
    expect(saved.publishing.drafts.x?.content.body).toBe("V1 X 正文");
    expect(saved.publishing.drafts.x?.needsReview).toBe(true);
    expect(saved.publishing.cover?.assetId).toBe(77);
    expect(saved.publishing.coverRounds).toEqual([]);
    expect(saved.publishing.versions?.[0]?.coverRounds).toHaveLength(1);
    expect(
      saved.publishing.versions?.[0]?.drafts.xiaohongshu?.content.body
    ).toBe("V1 小红书");
    expect(saved.publishing.versions?.[0]?.cover?.assetId).toBe(77);
    expect(
      saved.publishing.versions?.[1]?.conversationSnapshot?.messages
    ).toEqual([{ role: "user", content: "V2 想法" }]);
    expect(initialized.publishing.activeVersionId).toBe("v1");
  });

  it("replays a version operation from the persisted receipt without creating another version", async () => {
    const initialized = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "initialize",
        activePlatform: "xiaohongshu",
        selectedPlatforms: ["xiaohongshu"],
        core: baseCore,
        content: { title: "V1", body: "原稿", tags: [] },
        basePublishingRevision: 0,
      },
    });
    const operation = {
      type: "create_version" as const,
      platform: "xiaohongshu" as const,
      core: { ...baseCore, thesis: "重试版本" },
      content: { title: "V2", body: "新稿", tags: [] },
      baseCoreRevision: 1,
      baseDraftRevision: 1,
      baseVersionRevision: initialized.publishing.versions?.find(
        v => v.versionId === "v1"
      )?.versionRevision,
      baseContainerRevision: initialized.publishing.containerRevision ?? 0,
    };

    const first = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation,
      operationToken: "persisted-token",
    });
    const updateCount = dbMocks.updateStoryBodyIfRevision.mock.calls.length;
    const retry = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation,
      operationToken: "persisted-token",
    });

    expect(retry.storyRevision).toBe(first.storyRevision);
    expect(retry.publishing.activeVersionId).toBe("v2");
    expect(retry.publishing.versions).toHaveLength(2);
    expect(dbMocks.updateStoryBodyIfRevision).toHaveBeenCalledTimes(updateCount);
    expect(retry.publishing.versionOperationReceipts).toEqual({
      "persisted-token": "v2",
    });
  });

  it("rejects stale container operations and keeps V1/V2 edits isolated", async () => {
    const initialized = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "initialize",
        activePlatform: "xiaohongshu",
        selectedPlatforms: ["xiaohongshu"],
        core: baseCore,
        content: { title: "V1", body: "V1 原稿", tags: [] },
        basePublishingRevision: 0,
      },
    });
    const created = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "create_version",
        platform: "xiaohongshu",
        core: { ...baseCore, thesis: "V2" },
        content: { title: "V2", body: "V2 原稿", tags: [] },
        baseCoreRevision: 1,
        baseDraftRevision: 1,
        baseVersionRevision: initialized.publishing.versions?.find(
          v => v.versionId === "v1"
        )?.versionRevision,
        baseContainerRevision: initialized.publishing.containerRevision ?? 0,
      },
    });

    await expect(
      writePublishingDraftState({
        storyId: 7,
        userId: 3,
        operation: {
          type: "select_version",
          versionId: "v1",
          baseContainerRevision: 0,
          baseVersionRevision: 1,
        },
      })
    ).rejects.toBeInstanceOf(PublishingDraftConflictError);

    const selectedV1 = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "select_version",
        versionId: "v1",
        baseContainerRevision: created.publishing.containerRevision ?? 0,
        baseVersionRevision: created.publishing.versions?.find(
          v => v.versionId === "v1"
        )?.versionRevision,
      },
    });
    await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "apply_wording",
        platform: "xiaohongshu",
        content: { title: "V1", body: "V1 修改后", tags: [] },
        baseDraftRevision: 1,
      },
    });
    const selectedV2 = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "select_version",
        versionId: "v2",
        baseContainerRevision: selectedV1.publishing.containerRevision ?? 0,
        baseVersionRevision: created.publishing.versions?.find(
          v => v.versionId === "v2"
        )?.versionRevision,
      },
    });

    expect(selectedV2.publishing.drafts.xiaohongshu?.content.body).toBe(
      "V2 原稿"
    );
    expect(
      selectedV2.publishing.versions?.find(v => v.versionId === "v1")?.drafts
        .xiaohongshu?.content.body
    ).toBe("V1 修改后");
  });
});
