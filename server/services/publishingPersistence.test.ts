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
  PublishingLegacyFallbackDisabledError,
  getPublishingDraftState,
  getPublishingMigrationMetrics,
  publishingProjectionHash,
  inspectPublishingProjection,
  inspectPublishingSerializedOutput,
  resetPublishingMigrationMetricsForTest,
  setPublishingLegacyReaderEnabled,
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
    resetPublishingMigrationMetricsForTest();
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

  it("freezes the pre-version confirmed intent into V1 in the same initialize CAS", async () => {
    story.body = {
      cards: [], shots: [], _revision: 2,
      confirmedIntent: {
        purpose: "social_post", audience: "public", platform: "xiaohongshu",
        desiredEffect: "让陌生读者愿意读完", status: "confirmed",
      },
    };
    const saved = await writePublishingDraftState({ storyId: 7, userId: 3, operation: {
      type: "initialize", activePlatform: "xiaohongshu", selectedPlatforms: ["xiaohongshu"],
      core: baseCore, content: { title: "V1", body: "正文", tags: [] }, basePublishingRevision: 0,
    }});
    expect(saved.publishing.versions?.[0]?.intentSnapshot).toMatchObject({
      primaryPurpose: "share", coreAudience: "public", channel: "xiaohongshu",
      status: "confirmed",
    });
    expect((story.body as Record<string, any>).publishing.versions[0].intentSnapshot).toEqual(
      saved.publishing.versions?.[0]?.intentSnapshot
    );
  });

  it("does not freeze intent for selection-only writes before V1 exists", async () => {
    story.body = { _revision: 2, confirmedIntent: { purpose: "gift", audience: "friends", platform: "private_archive", status: "confirmed" } };
    const saved = await writePublishingDraftState({ storyId: 7, userId: 3, operation: {
      type: "set_selection", activePlatform: "x", selectedPlatforms: ["x"], basePublishingRevision: 0,
    }});
    expect(saved.publishing.versions?.[0]?.intentSnapshot).toBeUndefined();
  });

  it("falls back to the initialize intent and never rewrites an existing V1 snapshot", async () => {
    const narrativeIntent = {
      primaryPurpose: "share" as const,
      secondaryPurposes: [],
      coreAudience: "陌生读者",
      secondaryAudiences: [],
      status: "confirmed" as const,
      updatedAt: 100,
    };
    const first = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "initialize",
        activePlatform: "xiaohongshu",
        selectedPlatforms: ["xiaohongshu"],
        core: baseCore,
        content: { title: "V1", body: "第一稿", tags: [] },
        narrativeIntent,
        basePublishingRevision: 0,
      },
    });
    const frozen = structuredClone(
      first.publishing.versions?.[0]?.intentSnapshot
    );
    (story.body as Record<string, unknown>).confirmedIntent = {
      purpose: "gift",
      audience: "friends",
      platform: "private_archive",
      status: "confirmed",
    };

    const regenerated = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "initialize",
        activePlatform: "xiaohongshu",
        selectedPlatforms: ["xiaohongshu"],
        core: { ...baseCore, thesis: "第二次生成" },
        content: { title: "仍是 V1", body: "第二稿", tags: [] },
        narrativeIntent: {
          ...narrativeIntent,
          primaryPurpose: "gift",
          coreAudience: "朋友",
          updatedAt: 200,
        },
        basePublishingRevision: first.publishing.revision,
      },
    });

    expect(frozen).toMatchObject({
      primaryPurpose: "share",
      coreAudience: "陌生读者",
    });
    expect(regenerated.publishing.versions?.[0]?.intentSnapshot).toEqual(
      frozen
    );
  });

  it("persists active top-level fields only as a projection of canonical versions", async () => {
    const saved = await writePublishingDraftState({ storyId: 7, userId: 3, operation: {
      type: "initialize", activePlatform: "xiaohongshu", selectedPlatforms: ["xiaohongshu"],
      core: baseCore, content: { title: "V1", body: "canonical", tags: [] }, basePublishingRevision: 0,
    }});
    const active = saved.publishing.versions?.find(v => v.versionId === saved.publishing.activeVersionId)!;
    expect(saved.publishing.core).toEqual(active.core);
    expect(saved.publishing.drafts).toEqual(active.drafts);
    expect(publishingProjectionHash(saved.publishing)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(getPublishingMigrationMetrics()).toMatchObject({ legacyWrites: 0 });
  });

  it("materializes a legacy-only Story on its first mutation without changing its projection", async () => {
    story.body = {
      _revision: 2,
      publishing: {
        version: 1,
        revision: 4,
        activePlatform: "x",
        selectedPlatforms: ["x"],
        core: {
          revision: 1,
          ...baseCore,
          updatedAt: 10,
        },
        drafts: {
          x: {
            platform: "x",
            content: { title: "Legacy", body: "legacy body", tags: [] },
            appliedBaseline: {
              title: "Legacy",
              body: "legacy body",
              tags: [],
            },
            sourceCoreRevision: 1,
            revision: 1,
            needsReview: false,
            updatedAt: 10,
          },
        },
        cover: null,
        coverRounds: [],
        updatedAt: 10,
      },
    };
    const before = await getPublishingDraftState(7, 3);
    const beforeHash = publishingProjectionHash(before.publishing);

    const materialized = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "set_selection",
        activePlatform: "x",
        selectedPlatforms: ["x"],
        basePublishingRevision: 4,
      },
    });

    expect(materialized.publishing.canonicalAuthority).toBe("versions");
    expect(publishingProjectionHash(materialized.publishing)).toBe(beforeHash);
    expect(materialized.publishing.versions?.[0]?.drafts.x?.content.body).toBe(
      "legacy body"
    );
  });

  it("rejects publishing state beyond the bounded Story-body budget", async () => {
    await expect(writePublishingDraftState({ storyId: 7, userId: 3, operation: {
      type: "initialize", activePlatform: "xiaohongshu", selectedPlatforms: ["xiaohongshu"],
      core: baseCore, content: { title: "huge", body: "字".repeat(800_000), tags: [] }, basePublishingRevision: 0,
    }})).rejects.toThrow(/publishing.*容量|capacity/i);
    expect(dbMocks.updateStoryBodyIfRevision).not.toHaveBeenCalled();
  });

  it("rejects an already oversized Story before CAS without a partial publishing write", async () => {
    story.body = { _revision: 2, padding: "x".repeat(4 * 1024 * 1024 + 1) };
    await expect(writePublishingDraftState({ storyId: 7, userId: 3, operation: {
      type: "set_selection", activePlatform: "x", selectedPlatforms: ["x"], basePublishingRevision: 0,
    }})).rejects.toThrow(/story.*容量|capacity/i);
    expect(dbMocks.updateStoryBodyIfRevision).not.toHaveBeenCalled();
  });

  it("fails closed when the legacy fallback reader is disabled and exposes real migration counters", async () => {
    story.body = { _revision: 2, publishing: { revision: 1, activePlatform: "x", drafts: {} } };
    await getPublishingDraftState(7, 3);
    expect(getPublishingMigrationMetrics().fallbackReads).toBe(1);
    setPublishingLegacyReaderEnabled(false);
    await expect(getPublishingDraftState(7, 3)).rejects.toBeInstanceOf(PublishingLegacyFallbackDisabledError);
    const malformed = { ...((await import("../../shared/publishingDraft")).emptyPublishingDraftState()), core: { revision: 1 } } as any;
    expect(inspectPublishingProjection(malformed).equivalent).toBe(false);
    inspectPublishingSerializedOutput(malformed);
    expect(getPublishingMigrationMetrics()).toMatchObject({ projectionMismatches: 1, legacyWrites: 1 });
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
        core: { ...baseCore, thesis: "每天记录产品决定" },
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
    expect(saved.publishing.versions?.[1]?.displayName).toBe(
      "V2 · 每天记录产品决定"
    );
    expect(saved.publishing.core?.thesis).toBe("每天记录产品决定");
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
      operation: { ...operation, displayName: "重试时不该覆盖" },
      operationToken: "persisted-token",
    });

    expect(retry.storyRevision).toBe(first.storyRevision);
    expect(retry.publishing.activeVersionId).toBe("v2");
    expect(retry.publishing.versions).toHaveLength(2);
    expect(retry.publishing.versions?.[1]?.displayName).toBe(
      "V2 · 重试版本"
    );
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

  it("keeps a V1 paid recovery receipt out of a newly created V2", async () => {
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
    const claimed = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "claim_cover_generation",
        generation: {
          operationToken: "paid-v1",
          versionId: "v1",
          status: "pending",
          platform: "xiaohongshu",
          provider: "midjourney",
          referenceAssetId: null,
          feedback: "",
          instructions: [],
          prompt: "cover prompt",
          roundId: "round-v1",
          taskId: "provider-task",
          claimedAt: 10,
          updatedAt: 10,
          expiresAt: 10_000,
        },
        basePublishingRevision: initialized.publishing.revision,
      },
    });
    const created = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "create_version",
        platform: "xiaohongshu",
        core: { ...baseCore, thesis: "V2" },
        content: { title: "V2", body: "新稿", tags: [] },
        baseCoreRevision: 1,
        baseDraftRevision: 1,
        baseVersionRevision: claimed.publishing.versions?.[0]?.versionRevision,
        baseContainerRevision: claimed.publishing.containerRevision ?? 0,
      },
    });

    expect(
      created.publishing.versions?.find(version => version.versionId === "v1")
        ?.coverGeneration?.operationToken
    ).toBe("paid-v1");
    expect(
      created.publishing.versions?.find(version => version.versionId === "v2")
        ?.coverGeneration
    ).toBeNull();
    expect(created.publishing.coverGeneration).toBeNull();
  });
});
