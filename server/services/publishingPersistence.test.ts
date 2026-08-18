import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computePublishingDraftContentHash,
  computePublishingVersionRequestHash,
  publishingDraftBufferKey,
} from "../../shared/publishingDraft";
import type { PublishingPlatformContextSnapshot } from "../../shared/publishingPlatformContext";

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
  compactPublishingTextOperations,
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

  it("keeps pending claims and the 32 most recently updated terminal text receipts", () => {
    const scope = {
      storyId: 7,
      versionId: "v1",
      platform: "x" as const,
      containerRevision: 0,
      versionRevision: 0,
      coreRevision: 0,
      draftRevision: 0,
      intentRevision: 0,
      contextRevision: 0,
    };
    const terminal = Object.fromEntries(Array.from({ length: 34 }, (_, index) => {
      const token = `terminal-${index}`;
      return [token, {
        status: "failed" as const,
        kind: "rewrite" as const,
        operationToken: token,
        requestHash: `hash-${index}`,
        scope,
        claimedAt: index,
        updatedAt: index,
        expiresAt: 100,
        error: "failed",
      }];
    }));
    // Updating an old object key must make it recent even though JavaScript
    // preserves that key's original insertion position.
    terminal["terminal-0"] = { ...terminal["terminal-0"], updatedAt: 100 };
    const pending = {
      status: "pending" as const,
      kind: "rewrite" as const,
      operationToken: "pending",
      requestHash: "pending-hash",
      scope,
      claimedAt: 50,
      updatedAt: 50,
      expiresAt: 200,
    };
    const compacted = compactPublishingTextOperations({ ...terminal, pending });

    expect(compacted.pending).toEqual(pending);
    expect(compacted["terminal-0"]).toEqual(terminal["terminal-0"]);
    expect(compacted["terminal-1"]).toBeUndefined();
    expect(compacted["terminal-2"]).toBeUndefined();
    expect(Object.values(compacted).filter(receipt => receipt.status !== "pending")).toHaveLength(32);
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

  it("refuses to persist a confirmed core change in place", async () => {
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

    const calls = dbMocks.updateStoryBodyIfRevision.mock.calls.length;
    await expect(writePublishingDraftState({
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
    })).rejects.toThrow(/version transition/i);

    const saved = await getPublishingDraftState(7, 3);
    expect(saved.publishing.core?.revision).toBe(1);
    expect(saved.publishing.drafts.x?.content.body).toBe("do not rewrite");
    expect(dbMocks.updateStoryBodyIfRevision).toHaveBeenCalledTimes(calls);
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

  it("commits a request-hash receipt atomically, replays lost response, and rejects token hash reuse", async () => {
    const initialized = await writePublishingDraftState({ storyId: 7, userId: 3, operation: {
      type: "initialize", activePlatform: "x", selectedPlatforms: ["x"], core: baseCore,
      content: { title: "V1", body: "one", tags: [] }, basePublishingRevision: 0,
    }});
    const v1Before = structuredClone(initialized.publishing.versions?.[0]);
    const operation = { type: "create_version" as const, storyId: 7, platform: "x" as const,
      core: { ...baseCore, thesis: "V2" }, content: { title: "V2", body: "two", tags: [] },
      baseCoreRevision: 1, baseDraftRevision: 1, baseVersionRevision: v1Before?.versionRevision,
      baseContainerRevision: initialized.publishing.containerRevision ?? 0, sourceVersionId: "v1",
      requestHash: "", bufferDisposition: "carry" as const,
      sourceBufferKey: publishingDraftBufferKey(7, "x", "v1"),
      sourceBufferHash: computePublishingDraftContentHash({ title: "V2", body: "two", tags: [] }) };
    operation.requestHash = computePublishingVersionRequestHash(operation);
    const first = await writePublishingDraftState({ storyId: 7, userId: 3, operationToken: "atomic-op", operation });
    const calls = dbMocks.updateStoryBodyIfRevision.mock.calls.length;
    const retry = await writePublishingDraftState({ storyId: 7, userId: 3, operationToken: "atomic-op", operation });
    expect(retry.publishing.versions).toHaveLength(2);
    expect(retry.publishing.versions?.[0]).toEqual(v1Before);
    expect(retry.publishing.versionOperationReceipts?.["atomic-op"]).toMatchObject({
      status: "committed", requestHash: operation.requestHash, versionId: "v2", bufferDisposition: "carry",
    });
    expect(first.committedReceipt).toMatchObject({ operationToken: "atomic-op", versionId: "v2" });
    expect(retry.committedReceipt).toEqual(first.committedReceipt);
    expect(dbMocks.updateStoryBodyIfRevision).toHaveBeenCalledTimes(calls);
    await expect(writePublishingDraftState({ storyId: 7, userId: 3, operationToken: "atomic-op",
      operation: { ...operation, requestHash: "different-hash" } })).rejects.toThrow(/request hash/i);
  });

  it("rejects a carry handshake whose key or content hash does not match its immutable scope", async () => {
    const initialized = await writePublishingDraftState({ storyId: 7, userId: 3, operation: {
      type: "initialize", activePlatform: "x", selectedPlatforms: ["x"], core: baseCore,
      content: { title: "V1", body: "one", tags: [] }, basePublishingRevision: 0,
    }});
    const base = {
      type: "create_version" as const, storyId: 7, platform: "x" as const,
      core: { ...baseCore, thesis: "V2" }, content: { title: "V2", body: "two", tags: [] },
      baseCoreRevision: 1, baseDraftRevision: 1,
      baseVersionRevision: initialized.publishing.versions?.[0]?.versionRevision,
      baseContainerRevision: initialized.publishing.containerRevision ?? 0,
      sourceVersionId: "v1", bufferDisposition: "carry" as const,
      sourceBufferKey: publishingDraftBufferKey(8, "x", "v1"),
      sourceBufferHash: computePublishingDraftContentHash({ title: "V2", body: "two", tags: [] }),
      requestHash: "",
    };
    const badKey = { ...base, requestHash: computePublishingVersionRequestHash(base) };
    await expect(writePublishingDraftState({ storyId: 7, userId: 3, operationToken: "bad-key", operation: badKey }))
      .rejects.toThrow(/buffer key/i);
    const badHashInput = { ...base, sourceBufferKey: publishingDraftBufferKey(7, "x", "v1"), sourceBufferHash: "pb2-wrong" };
    const badHash = { ...badHashInput, requestHash: computePublishingVersionRequestHash(badHashInput) };
    await expect(writePublishingDraftState({ storyId: 7, userId: 3, operationToken: "bad-hash", operation: badHash }))
      .rejects.toThrow(/buffer hash/i);
  });

  it("claims and completes a version-scoped text operation without duplicate work on retry", async () => {
    const scope = {
      storyId: 7,
      versionId: "v1",
      platform: "x" as const,
      containerRevision: 0,
      versionRevision: 0,
      coreRevision: 0,
      draftRevision: 0,
      intentRevision: 0,
      contextRevision: 0,
    };
    const pending = {
      status: "pending" as const,
      kind: "rewrite" as const,
      operationToken: "text-op",
      requestHash: "pto2-1234567890abcdef1234567890abcdef",
      scope,
      claimedAt: 10,
      updatedAt: 10,
      expiresAt: 1_000,
    };
    const claimed = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "claim_text_operation",
        receipt: pending,
        baseContainerRevision: 0,
        baseVersionRevision: 0,
      },
    });
    expect(claimed.textOperationReceipt).toEqual(pending);
    expect(claimed.publishing.versions?.[0]?.textOperations?.["text-op"]).toEqual(pending);
    const claimCalls = dbMocks.updateStoryBodyIfRevision.mock.calls.length;
    const claimRetry = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "claim_text_operation",
        receipt: pending,
        baseContainerRevision: 0,
        baseVersionRevision: 0,
      },
    });
    expect(claimRetry.textOperationReceipt).toEqual(pending);
    expect(dbMocks.updateStoryBodyIfRevision).toHaveBeenCalledTimes(claimCalls);
    await expect(writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "claim_text_operation",
        receipt: { ...pending, requestHash: "pto2-different" },
        baseContainerRevision: 0,
        baseVersionRevision: 0,
      },
    })).rejects.toThrow(/different request hash/i);

    const completed = {
      ...pending,
      status: "completed" as const,
      updatedAt: 20,
      result: {
        status: "preview" as const,
        content: { title: "", body: "revised", tags: [] },
        modelLabel: "mock-model",
      },
    };
    const v1 = claimed.publishing.versions?.[0];
    const settled = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "settle_text_operation",
        receipt: completed,
        baseContainerRevision: claimed.publishing.containerRevision ?? 0,
        baseVersionRevision: v1?.versionRevision ?? 0,
      },
    });
    expect(settled.textOperationReceipt).toEqual(completed);
    const settleCalls = dbMocks.updateStoryBodyIfRevision.mock.calls.length;
    const settleRetry = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "settle_text_operation",
        receipt: completed,
        baseContainerRevision: claimed.publishing.containerRevision ?? 0,
        baseVersionRevision: v1?.versionRevision ?? 0,
      },
    });
    expect(settleRetry.textOperationReceipt).toEqual(completed);
    expect(dbMocks.updateStoryBodyIfRevision).toHaveBeenCalledTimes(settleCalls);
  });

  it("appends immutable platform context and selects only saved candidate tags", async () => {
    const initialized = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      now: 100,
      operation: {
        type: "initialize",
        activePlatform: "xiaohongshu",
        selectedPlatforms: ["xiaohongshu"],
        core: baseCore,
        content: { title: "V1", body: "AI 工具写作", tags: ["写作"] },
        basePublishingRevision: 0,
      },
    });
    const version = initialized.publishing.versions?.[0];
    const snapshot: PublishingPlatformContextSnapshot = {
      snapshotId: "ctx-1",
      versionId: "v1",
      platform: "xiaohongshu",
      sourceRevision: 1,
      revision: 1,
      status: "verified_fresh",
      capability: "verified",
      providerId: "authorized-fixture",
      providerLabel: "授权测试源",
      authorization: { status: "official", reference: "console-2026-08" },
      coverage: "公开话题榜",
      fetchedAt: 120,
      sourcePublishedAt: 110,
      expiresAt: 500,
      sourceDocument: "https://provider.example/docs",
      parserVersion: "fixture-v1",
      rawDigest: `sha256-${"a".repeat(64)}`,
      candidates: [{ id: "topic-ai", label: "AI 工具", sourcePublishedAt: 110 }],
      contentSuggestions: ["写作"],
      message: "fresh",
      createdAt: 120,
    };
    const appended = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      now: 120,
      operation: {
        type: "append_platform_context_snapshot",
        versionId: "v1",
        platform: "xiaohongshu",
        snapshot,
        baseContainerRevision: initialized.publishing.containerRevision ?? 0,
        baseVersionRevision: version?.versionRevision ?? 0,
        baseContextRevision: 0,
        baseSourceRevision: 1,
      },
    });
    expect(appended.publishing.versions?.[0]?.platformContexts?.xiaohongshu)
      .toMatchObject({ revision: 1, snapshots: [{ snapshotId: "ctx-1" }] });
    const appendCalls = dbMocks.updateStoryBodyIfRevision.mock.calls.length;
    const replay = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      now: 130,
      operation: {
        type: "append_platform_context_snapshot",
        versionId: "v1",
        platform: "xiaohongshu",
        snapshot,
        baseContainerRevision: initialized.publishing.containerRevision ?? 0,
        baseVersionRevision: version?.versionRevision ?? 0,
        baseContextRevision: 0,
        baseSourceRevision: 1,
      },
    });
    expect(replay.publishing.versions?.[0]?.platformContexts?.xiaohongshu?.snapshots)
      .toHaveLength(1);
    expect(dbMocks.updateStoryBodyIfRevision).toHaveBeenCalledTimes(appendCalls);

    const appendedVersion = appended.publishing.versions?.[0];
    const selected = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      now: 140,
      operation: {
        type: "select_platform_context_tags",
        versionId: "v1",
        platform: "xiaohongshu",
        snapshotId: "ctx-1",
        candidateIds: ["topic-ai"],
        contentTags: ["写作"],
        baseContainerRevision: appended.publishing.containerRevision ?? 0,
        baseVersionRevision: appendedVersion?.versionRevision ?? 0,
        baseContextRevision: 1,
        baseSourceRevision: 1,
      },
    });
    expect(selected.publishing.versions?.[0]?.platformContexts?.xiaohongshu)
      .toMatchObject({
        revision: 2,
        selectedSnapshotId: "ctx-1",
        selectedTags: ["AI 工具", "写作"],
      });
    const selectedVersion = selected.publishing.versions?.[0];
    const scopedClaim = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      now: 150,
      operation: {
        type: "claim_text_operation",
        receipt: {
          status: "pending",
          kind: "rewrite",
          operationToken: "context-scoped-text",
          requestHash: "pto2-context",
          scope: {
            storyId: 7,
            versionId: "v1",
            platform: "xiaohongshu",
            containerRevision: selected.publishing.containerRevision ?? 0,
            versionRevision: selectedVersion?.versionRevision ?? 0,
            coreRevision: 1,
            draftRevision: 1,
            intentRevision: 0,
            contextRevision: 2,
          },
          claimedAt: 150,
          updatedAt: 150,
          expiresAt: 300,
        },
        baseContainerRevision: selected.publishing.containerRevision ?? 0,
        baseVersionRevision: selectedVersion?.versionRevision ?? 0,
      },
    });
    expect(scopedClaim.textOperationReceipt?.scope.contextRevision).toBe(2);
    const claimedVersion = scopedClaim.publishing.versions?.[0];
    const v2 = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      now: 160,
      operation: {
        type: "create_version",
        platform: "xiaohongshu",
        core: { ...baseCore, thesis: "新的用途" },
        content: { title: "V2", body: "新的版本", tags: [] },
        baseCoreRevision: 1,
        baseDraftRevision: 1,
        baseVersionRevision: claimedVersion?.versionRevision,
        baseContainerRevision: scopedClaim.publishing.containerRevision ?? 0,
      },
    });
    expect(v2.publishing.versions?.find(version => version.versionId === "v1")
      ?.platformContexts?.xiaohongshu?.selectedTags).toEqual(["AI 工具", "写作"]);
    expect(v2.publishing.versions?.find(version => version.versionId === "v2")
      ?.platformContexts).toEqual({});
  });

  it("refuses to persist unavailable platform context as a historical snapshot", async () => {
    const initialized = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "initialize",
        activePlatform: "xiaohongshu",
        selectedPlatforms: ["xiaohongshu"],
        core: baseCore,
        content: { title: "V1", body: "正文", tags: [] },
        basePublishingRevision: 0,
      },
    });
    const version = initialized.publishing.versions?.[0];
    await expect(writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "append_platform_context_snapshot",
        versionId: "v1",
        platform: "xiaohongshu",
        snapshot: {
          snapshotId: "ctx-unavailable",
          versionId: "v1",
          platform: "xiaohongshu",
          sourceRevision: 1,
          revision: 1,
          status: "unavailable",
          capability: "unavailable",
          providerId: "unavailable-xiaohongshu",
          providerLabel: "未配置",
          authorization: { status: "unavailable", reference: "missing" },
          coverage: "",
          fetchedAt: 1,
          sourcePublishedAt: null,
          expiresAt: 1,
          sourceDocument: "",
          parserVersion: "unavailable-v1",
          rawDigest: "sha256-none",
          candidates: [],
          contentSuggestions: [],
          message: "不可用",
          createdAt: 1,
        },
        baseContainerRevision: initialized.publishing.containerRevision ?? 0,
        baseVersionRevision: version?.versionRevision ?? 0,
        baseContextRevision: 0,
        baseSourceRevision: 1,
      },
    })).rejects.toThrow(/verified context/i);
  });

  it("commits initial generated content and its completed text receipt in one Story CAS", async () => {
    const scope = {
      storyId: 7,
      versionId: "v1",
      platform: "x" as const,
      containerRevision: 0,
      versionRevision: 0,
      coreRevision: 0,
      draftRevision: 0,
      intentRevision: 0,
      contextRevision: 0,
    };
    const pending = {
      status: "pending" as const,
      kind: "generate" as const,
      operationToken: "generate-op",
      requestHash: "pto2-abcdefabcdefabcdefabcdefabcdefab",
      scope,
      claimedAt: 10,
      updatedAt: 10,
      expiresAt: 1_000,
    };
    const claimed = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "claim_text_operation",
        receipt: pending,
        baseContainerRevision: 0,
        baseVersionRevision: 0,
      },
    });
    const completed = {
      ...pending,
      status: "completed" as const,
      updatedAt: 20,
      result: {
        status: "created" as const,
        core: baseCore,
        content: { title: "", body: "generated", tags: [] },
        modelLabel: "mock-model",
        draftRevision: 1,
      },
    };
    const claimedVersion = claimed.publishing.versions?.[0];
    const saved = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "initialize",
        activePlatform: "x",
        selectedPlatforms: ["x"],
        core: baseCore,
        content: completed.result.content,
        basePublishingRevision: claimed.publishing.revision,
        baseContainerRevision: claimed.publishing.containerRevision,
        baseVersionRevision: claimedVersion?.versionRevision,
        textOperationReceipt: completed,
      },
    });
    expect(saved.publishing.drafts.x?.content.body).toBe("generated");
    expect(saved.textOperationReceipt).toEqual(completed);
    expect(saved.publishing.versions?.[0]?.textOperations?.["generate-op"]).toEqual(completed);
    const calls = dbMocks.updateStoryBodyIfRevision.mock.calls.length;
    const retry = await writePublishingDraftState({
      storyId: 7,
      userId: 3,
      operation: {
        type: "initialize",
        activePlatform: "x",
        selectedPlatforms: ["x"],
        core: baseCore,
        content: completed.result.content,
        basePublishingRevision: claimed.publishing.revision,
        baseContainerRevision: claimed.publishing.containerRevision,
        baseVersionRevision: claimedVersion?.versionRevision,
        textOperationReceipt: completed,
      },
    });
    expect(retry.textOperationReceipt).toEqual(completed);
    expect(dbMocks.updateStoryBodyIfRevision).toHaveBeenCalledTimes(calls);
  });

  it("treats cancel as a zero-write operation", async () => {
    const operation = {
      type: "create_version", storyId: 7, platform: "x", core: baseCore,
      content: { title: "", body: "cancel", tags: [] }, baseCoreRevision: 0, baseDraftRevision: 0,
      baseContainerRevision: 0, sourceVersionId: "v1", bufferDisposition: "cancel" as const,
      requestHash: "",
    } as const;
    const hashed = { ...operation, requestHash: computePublishingVersionRequestHash(operation) };
    const result = await writePublishingDraftState({ storyId: 7, userId: 3, operationToken: "cancel-op", operation: hashed });
    expect(result.publishing.versions).toHaveLength(1);
    expect(dbMocks.updateStoryBodyIfRevision).not.toHaveBeenCalled();
  });

  it("replays select and rename lost responses without advancing revisions twice", async () => {
    const initialized = await writePublishingDraftState({ storyId: 7, userId: 3, operation: {
      type: "initialize", activePlatform: "x", selectedPlatforms: ["x"], core: baseCore,
      content: { title: "", body: "one", tags: [] }, basePublishingRevision: 0,
    }});
    const select = { type: "select_version" as const, versionId: "v1", storyId: 7,
      baseContainerRevision: initialized.publishing.containerRevision ?? 0,
      baseVersionRevision: initialized.publishing.versions?.[0]?.versionRevision };
    await expect(writePublishingDraftState({ storyId: 7, userId: 3, operationToken: "bad-select-hash",
      operation: { ...select, requestHash: "pvo2-not-canonical" } }))
      .rejects.toThrow(/canonical payload/i);
    const firstSelect = await writePublishingDraftState({ storyId: 7, userId: 3, operationToken: "select-op", operation: select });
    const selectCalls = dbMocks.updateStoryBodyIfRevision.mock.calls.length;
    const retrySelect = await writePublishingDraftState({ storyId: 7, userId: 3, operationToken: "select-op", operation: select });
    expect(retrySelect.publishing.containerRevision).toBe(firstSelect.publishing.containerRevision);
    expect(retrySelect.committedReceipt?.operationKind).toBe("select_version");
    expect(dbMocks.updateStoryBodyIfRevision).toHaveBeenCalledTimes(selectCalls);

    const rename = { type: "rename_version" as const, versionId: "v1", storyId: 7, displayName: "人工名",
      baseContainerRevision: firstSelect.publishing.containerRevision ?? 0,
      baseVersionRevision: firstSelect.publishing.versions?.[0]?.versionRevision };
    const firstRename = await writePublishingDraftState({ storyId: 7, userId: 3, operationToken: "rename-op", operation: rename });
    const renameCalls = dbMocks.updateStoryBodyIfRevision.mock.calls.length;
    const retryRename = await writePublishingDraftState({ storyId: 7, userId: 3, operationToken: "rename-op", operation: rename });
    expect(retryRename.publishing.versions?.[0]?.displayName).toBe("人工名");
    expect(retryRename.publishing.containerRevision).toBe(firstRename.publishing.containerRevision);
    expect(dbMocks.updateStoryBodyIfRevision).toHaveBeenCalledTimes(renameCalls);
  });

  it("replays an inactive-version rename while preserving the originally active version", async () => {
    const initialized = await writePublishingDraftState({ storyId: 7, userId: 3, operation: {
      type: "initialize", activePlatform: "x", selectedPlatforms: ["x"], core: baseCore,
      content: { title: "", body: "v1", tags: [] }, basePublishingRevision: 0,
    }});
    const created = await writePublishingDraftState({ storyId: 7, userId: 3, operation: {
      type: "create_version", platform: "x", core: { ...baseCore, thesis: "v2" },
      content: { title: "", body: "v2", tags: [] }, baseCoreRevision: 1, baseDraftRevision: 1,
      baseVersionRevision: initialized.publishing.versions?.[0]?.versionRevision,
      baseContainerRevision: initialized.publishing.containerRevision ?? 0,
    }});
    const rename = { type: "rename_version" as const, versionId: "v1", displayName: "V1 人工名",
      baseContainerRevision: created.publishing.containerRevision ?? 0,
      baseVersionRevision: created.publishing.versions?.find(v => v.versionId === "v1")?.versionRevision };
    const first = await writePublishingDraftState({ storyId: 7, userId: 3, operationToken: "rename-inactive", operation: rename });
    const calls = dbMocks.updateStoryBodyIfRevision.mock.calls.length;
    const retry = await writePublishingDraftState({ storyId: 7, userId: 3, operationToken: "rename-inactive", operation: rename });
    expect(first.publishing.activeVersionId).toBe("v2");
    expect(retry.publishing.activeVersionId).toBe("v2");
    expect(retry.publishing.versions?.find(v => v.versionId === "v1")).toMatchObject({
      displayName: "V1 人工名", versionRevision: 2,
    });
    expect(retry.publishing.containerRevision).toBe(first.publishing.containerRevision);
    expect(dbMocks.updateStoryBodyIfRevision).toHaveBeenCalledTimes(calls);
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

  it("propagates a local persistence write failure unchanged, not as a revision conflict", async () => {
    // A disk/db-layer failure (not a stale-revision rejection) must surface
    // as-is to the caller — writePublishingDraftState only translates
    // StoryBodyRevisionConflictError into PublishingDraftConflictError, it
    // must not swallow or misclassify other failures.
    dbMocks.updateStoryBodyIfRevision.mockRejectedValueOnce(
      new Error("ENOSPC: no space left on device")
    );

    await expect(
      writePublishingDraftState({
        storyId: 7,
        userId: 3,
        operation: {
          type: "initialize",
          activePlatform: "xiaohongshu",
          selectedPlatforms: ["xiaohongshu"],
          core: baseCore,
          content: { title: "", body: "source", tags: [] },
          basePublishingRevision: 0,
        },
      })
    ).rejects.toThrow("ENOSPC");
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
