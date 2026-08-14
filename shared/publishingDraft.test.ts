import { describe, expect, it } from "vitest";

import {
  PUBLISHING_PLATFORM_IDS,
  PUBLISHING_PLATFORM_REGISTRY,
  applyPublishingWordingEdit,
  computePublishingDraftContentHash,
  computePublishingVersionRequestHash,
  confirmPublishingCoreChange,
  emptyPublishingDraftState,
  getPublishingContentError,
  getXThreadStats,
  numberXThreadPosts,
  normalizePublishingDraftState,
  normalizePublishingNarrativeIntent,
  publishingDraftBufferKey,
  resolvePublishingIntentProfile,
  resolvePublishingActiveVersion,
  upsertPublishingPlatformDraft,
  xWeightedCharacterLength,
  type PublishingDraftContent,
  type PublishingDraftState,
  type PublishingPlatformId,
  type PublishingStoryCore,
} from "./publishingDraft";

const NOW = 1_786_000_000_000;

function content(
  body: string,
  title = "标题",
  tags: string[] = []
): PublishingDraftContent {
  return { title, body, tags };
}

function core(revision = 1): PublishingStoryCore {
  return {
    revision,
    facts: ["Codex 触发了不必要的子 Agent"],
    thesis: "工具不该把人的时间浪费在无意义的自动化上",
    emotion: "警惕，也有一点无奈",
    voiceTraits: ["直接", "克制", "带个人判断"],
    visualConcept: "一个人看着被无数分支拖走的时间",
    updatedAt: NOW,
  };
}

function stateWithDrafts(): PublishingDraftState {
  let state: PublishingDraftState = {
    ...emptyPublishingDraftState(NOW),
    activePlatform: "xiaohongshu",
    selectedPlatforms: ["xiaohongshu", "x", "instagram"],
    core: core(),
  };
  state = upsertPublishingPlatformDraft(state, {
    platform: "xiaohongshu",
    content: content("我在小红书写下自己的判断。", "别让 AI 偷走人的时间", [
      "AI工具",
    ]),
    now: NOW,
  });
  return state;
}

describe("publishing platform registry", () => {
  it("defines the six confirmed platforms and deterministic cover exports", () => {
    expect(PUBLISHING_PLATFORM_IDS).toEqual([
      "xiaohongshu",
      "x",
      "instagram",
      "linkedin",
      "wechat_moments",
      "douyin_tiktok",
    ]);

    expect(
      PUBLISHING_PLATFORM_IDS.map(id => ({
        id,
        size: [
          PUBLISHING_PLATFORM_REGISTRY[id].cover.width,
          PUBLISHING_PLATFORM_REGISTRY[id].cover.height,
        ],
      }))
    ).toEqual([
      { id: "xiaohongshu", size: [1080, 1440] },
      { id: "x", size: [1600, 900] },
      { id: "instagram", size: [1080, 1350] },
      { id: "linkedin", size: [1200, 627] },
      { id: "wechat_moments", size: [1080, 1080] },
      { id: "douyin_tiktok", size: [1080, 1920] },
    ]);

    for (const adapter of Object.values(PUBLISHING_PLATFORM_REGISTRY)) {
      expect(adapter.copyGuidance.length).toBeGreaterThan(0);
      expect(adapter.cover.safeArea.top).toBeGreaterThanOrEqual(0);
      expect(adapter.cover.safeArea.bottom).toBeLessThanOrEqual(1);
      expect(adapter.cover.safeArea.top).toBeLessThan(
        adapter.cover.safeArea.bottom
      );
      expect(adapter.cover.safeArea.left).toBeLessThan(
        adapter.cover.safeArea.right
      );
    }
  });

  it("counts X text conservatively and reports thread limits", () => {
    expect(xWeightedCharacterLength("a".repeat(280))).toBe(280);
    expect(xWeightedCharacterLength("中".repeat(140))).toBe(280);

    const valid = {
      title: "X does not use this title",
      body: "1/2 第一条\n\n2/2 second post",
      tags: ["AI"],
    };
    expect(getXThreadStats(valid)).toMatchObject({
      postCount: 2,
      error: null,
    });
    expect(getPublishingContentError("x", valid)).toBeNull();
    expect(numberXThreadPosts("第一条\n\n第二条")).toBe(
      "1/2 第一条\n\n2/2 第二条"
    );
    expect(numberXThreadPosts(valid.body)).toBe(valid.body);
    expect(
      getPublishingContentError("x", {
        title: "",
        body: "中".repeat(141),
        tags: [],
      })
    ).toContain("第 1 条超过 280");
  });
});

describe("publishing version operation identity", () => {
  it("uses stable 128-bit fingerprints and version-scoped buffer keys", () => {
    const input = {
      storyId: 7,
      sourceVersionId: "v1",
      platform: "x" as const,
      baseContainerRevision: 2,
      baseVersionRevision: 3,
      baseCoreRevision: 4,
      baseDraftRevision: 5,
      core: core(),
      content: content("draft"),
      bufferDisposition: "carry" as const,
      sourceBufferKey: publishingDraftBufferKey(7, "x", "v1"),
      sourceBufferHash: computePublishingDraftContentHash(content("draft")),
    };
    expect(computePublishingVersionRequestHash(input)).toMatch(/^pv2-[a-f0-9]{32}$/);
    expect(computePublishingVersionRequestHash({ ...input })).toBe(
      computePublishingVersionRequestHash(input)
    );
    expect(computePublishingVersionRequestHash({ ...input, storyId: 8 })).not.toBe(
      computePublishingVersionRequestHash(input)
    );
    expect(input.sourceBufferHash).toMatch(/^pb2-[a-f0-9]{32}$/);
    expect(publishingDraftBufferKey(7, "x", "v2")).toBe("7:v2:x");
  });
});

describe("normalizePublishingDraftState", () => {
  it("keeps only well-scoped committed version receipts", () => {
    const version = (versionId: string, sequence: number) => ({
      versionId,
      sequence,
      displayName: versionId.toUpperCase(),
      parentId: sequence === 1 ? null : "v1",
      versionRevision: 1,
      core: core(),
      drafts: {},
      activePlatform: "x",
      selectedPlatforms: ["x"],
      narrativeIntent: {},
      cover: null,
      coverRounds: [],
      conversationSnapshot: null,
    });
    const valid = {
      status: "committed",
      operationKind: "create_version",
      operationToken: "valid",
      requestHash: "pv2-1234567890abcdef1234567890abcdef",
      versionId: "v2",
      resultActiveVersionId: "v2",
      sourceVersionId: "v1",
      storyId: 7,
      platform: "x",
      bufferDisposition: "carry",
      sourceBufferKey: "7:x",
      sourceBufferHash: "pb2-1234567890abcdef1234567890abcdef",
      committedAt: NOW,
      baseContainerRevision: 1,
      baseVersionRevision: 1,
    };
    const normalized = normalizePublishingDraftState({
      canonicalAuthority: "versions",
      activeVersionId: "v2",
      containerRevision: 2,
      versions: [version("v1", 1), version("v2", 2)],
      versionOperationReceipts: {
        valid,
        "bad-active": { ...valid, operationToken: "bad-active", resultActiveVersionId: "v9" },
        "bad-story": { ...valid, operationToken: "bad-story", storyId: Number.NaN },
        "bad-time": { ...valid, operationToken: "bad-time", committedAt: 1.5 },
        "bad-token": { ...valid, operationToken: "another-token" },
        "legacy-valid": "v1",
        "legacy-missing": "v9",
      },
    }, NOW);
    expect(normalized.versionOperationReceipts).toEqual({
      valid,
      "legacy-valid": "v1",
    });
  });

  it("resolves publishing intent from the active version snapshot instead of a conflicting pre-version profile", () => {
    const normalized = normalizePublishingDraftState(
      {
        activeVersionId: "v1",
        containerRevision: 1,
        versions: [
          {
            versionId: "v1",
            sequence: 1,
            displayName: "V1",
            activePlatform: "xiaohongshu",
            selectedPlatforms: ["xiaohongshu"],
            intentSnapshot: {
              primaryPurpose: "share",
              secondaryPurposes: [],
              coreAudience: "陌生读者",
              secondaryAudiences: [],
              channel: "xiaohongshu",
              expression: { tone: "真诚", desiredEffect: "愿意读完" },
              status: "confirmed",
              revision: 3,
              provenance: { source: "version_snapshot", updatedAt: NOW },
            },
          },
        ],
      },
      NOW
    );
    const preVersion = {
      primaryPurpose: "preserve" as const,
      secondaryPurposes: [],
      coreAudience: "自己",
      secondaryAudiences: [],
      channel: "private_archive",
      expression: { tone: "", desiredEffect: "" },
      status: "confirmed" as const,
      revision: 2,
      provenance: { source: "user" as const, updatedAt: NOW },
    };

    expect(resolvePublishingIntentProfile(normalized, preVersion)).toMatchObject({
      authority: "active_version",
      profile: { primaryPurpose: "share", coreAudience: "陌生读者" },
    });
  });

  it("keeps an empty synthesized V1 in the pre-version phase", () => {
    const preVersion = {
      primaryPurpose: "preserve" as const, secondaryPurposes: [], coreAudience: "自己",
      secondaryAudiences: [], channel: "private_archive",
      expression: { tone: "", desiredEffect: "留给自己" }, status: "confirmed" as const,
      revision: 2, provenance: { source: "user" as const, updatedAt: NOW },
    };
    expect(resolvePublishingIntentProfile(emptyPublishingDraftState(NOW), preVersion)).toEqual({
      profile: preVersion,
      authority: "pre_version",
    });
  });

  it("keeps selection-only state in the pre-version phase", () => {
    const preVersion = {
      primaryPurpose: "share" as const,
      secondaryPurposes: [],
      coreAudience: "陌生读者",
      secondaryAudiences: [],
      channel: "x",
      expression: { tone: "", desiredEffect: "" },
      status: "confirmed" as const,
      revision: 3,
      provenance: { source: "user" as const, updatedAt: NOW },
    };
    const selectionOnly = normalizePublishingDraftState(
      {
        revision: 1,
        containerRevision: 1,
        activePlatform: "x",
        selectedPlatforms: ["x"],
        activeVersionId: "v1",
        versions: [
          {
            versionId: "v1",
            sequence: 1,
            displayName: "V1",
            versionRevision: 1,
            activePlatform: "x",
            selectedPlatforms: ["x"],
          },
        ],
      },
      NOW
    );

    expect(resolvePublishingIntentProfile(selectionOnly, preVersion)).toEqual({
      profile: preVersion,
      authority: "pre_version",
    });
  });

  it("treats legacy core/drafts as a real V1 even without intentSnapshot", () => {
    const state = normalizePublishingDraftState({ core: core(), drafts: {
      xiaohongshu: { platform: "xiaohongshu", content: content("已有发布稿") },
    } }, NOW);
    const resolved = resolvePublishingIntentProfile(state, null);
    expect(resolved.authority).toBe("active_version");
    expect(resolved.profile?.provenance.source).toBe("version_snapshot");
  });
  it("maps legacy chat intent into a compact provisional version purpose", () => {
    expect(
      normalizePublishingNarrativeIntent(
        {
          purpose: "gift",
          audience: "specific_person",
        },
        NOW
      )
    ).toMatchObject({
      primaryPurpose: "gift",
      coreAudience: "某位重要的人",
      status: "provisional",
    });
  });

  it("keeps a version's purpose and multiple audiences independent", () => {
    const normalized = normalizePublishingDraftState(
      {
        ...emptyPublishingDraftState(NOW),
        versions: [
          {
            versionId: "v1",
            sequence: 1,
            displayName: "V1",
            parentId: null,
            versionRevision: 1,
            activePlatform: "xiaohongshu",
            selectedPlatforms: ["xiaohongshu"],
            drafts: {},
            core: null,
            cover: null,
            coverRounds: [],
            narrativeIntent: {
              primaryPurpose: "gift",
              secondaryPurposes: ["share"],
              coreAudience: "妈妈",
              secondaryAudiences: ["朋友圈朋友"],
              status: "confirmed",
              updatedAt: NOW,
            },
            conversationSnapshot: null,
            videoStoryboard: null,
          },
        ],
        activeVersionId: "v1",
        containerRevision: 1,
      },
      NOW
    );

    expect(resolvePublishingActiveVersion(normalized).narrativeIntent).toEqual({
      primaryPurpose: "gift",
      secondaryPurposes: ["share"],
      coreAudience: "妈妈",
      secondaryAudiences: ["朋友圈朋友"],
      status: "confirmed",
      updatedAt: NOW,
    });
  });

  it("retains a submitted cover task so a refreshed workspace can recover it", () => {
    const normalized = normalizePublishingDraftState(
      {
        ...emptyPublishingDraftState(NOW),
        coverGeneration: {
          operationToken: "cover-op-1",
          versionId: "v1",
          status: "pending",
          platform: "xiaohongshu",
          referenceAssetId: 52,
          feedback: "让人物更小",
          instructions: ["更多留白", "让人物更小", "更多留白"],
          artReference: {
            label: "参考.png",
            imageUrl: "data:image/png;base64,too-large-for-state",
            style: ["纸本拼贴"],
            palette: ["矿物色"],
            light: ["光成为实体"],
            composition: ["极端留白"],
            material: ["粗纸纤维"],
            mood: ["温柔的不安"],
          },
          prompt: "durable prompt",
          roundId: "round-op-1",
          taskId: "302-task-1",
          claimedAt: NOW,
          updatedAt: NOW,
          expiresAt: NOW + 600_000,
        },
      },
      NOW + 1
    );

    expect(normalized.coverGeneration).toMatchObject({
      operationToken: "cover-op-1",
      status: "pending",
      taskId: "302-task-1",
      roundId: "round-op-1",
      instructions: ["更多留白", "让人物更小"],
      artReference: expect.objectContaining({
        label: "参考.png",
        style: ["纸本拼贴"],
      }),
    });
    expect(normalized.coverGeneration?.artReference?.imageUrl).toBeUndefined();
  });

  it("normalizes legacy state into an isolated V1 canonical version", () => {
    const normalized = normalizePublishingDraftState(
      {
        activePlatform: "x",
        selectedPlatforms: ["x"],
        core: core(2),
        drafts: { x: { platform: "x", content: content("legacy") } },
        cover: { assetId: 99, sourceCoreRevision: 2, createdAt: NOW },
      },
      NOW
    );
    expect(normalized.activeVersionId).toBe("v1");
    expect(normalized.versions).toHaveLength(1);
    expect(resolvePublishingActiveVersion(normalized)).toMatchObject({
      versionId: "v1",
      displayName: "V1",
      activePlatform: "x",
      cover: { assetId: 99 },
    });
    expect(normalized.versions?.[0].drafts.x?.content).not.toBe(
      normalized.drafts.x?.content
    );
  });

  it("inventories canonical V1 coexisting with conflicting legacy projections", () => {
    const canonicalV1 = resolvePublishingActiveVersion(
      normalizePublishingDraftState(
        {
          activePlatform: "xiaohongshu",
          selectedPlatforms: ["xiaohongshu"],
          core: core(1),
          drafts: {
            xiaohongshu: {
              platform: "xiaohongshu",
              content: content("canonical V1"),
            },
          },
        },
        NOW
      )
    );
    const normalized = normalizePublishingDraftState(
      {
        activePlatform: "x",
        selectedPlatforms: ["x"],
        core: { ...core(9), thesis: "stale legacy core" },
        drafts: { x: { platform: "x", content: content("stale legacy") } },
        narrativeIntent: { primaryPurpose: "gift", coreAudience: "旧值" },
        confirmedIntent: { purpose: "share", audience: "另一份旧值" },
        activeVersionId: "v1",
        containerRevision: 4,
        versions: [
          {
            ...canonicalV1,
            narrativeIntent: {
              primaryPurpose: "persuade",
              secondaryPurposes: [],
              coreAudience: "产品团队",
              secondaryAudiences: [],
              status: "confirmed",
              updatedAt: NOW,
            },
            cover: { assetId: 70, sourceCoreRevision: 1, createdAt: NOW },
            coverRounds: [
              {
                id: "v1-paid-round",
                platform: "xiaohongshu",
                sourceCoreRevision: 1,
                parentAssetId: null,
                feedback: "保留正式封面，候选另存",
                assetIds: [71, 72, 73, 74],
                createdAt: NOW,
              },
            ],
          },
        ],
      },
      NOW + 1
    );

    const active = resolvePublishingActiveVersion(normalized);
    expect(active.drafts.xiaohongshu?.content.body).toBe("canonical V1");
    expect(active.narrativeIntent).toMatchObject({
      primaryPurpose: "persuade",
      coreAudience: "产品团队",
      status: "confirmed",
    });
    expect(active.cover?.assetId).toBe(70);
    expect(active.coverRounds[0]?.assetIds).toEqual([71, 72, 73, 74]);
  });

  it("keeps formal cover provenance when malformed version metadata is supplied", () => {
    const normalized = normalizePublishingDraftState(
      {
        activePlatform: "instagram",
        selectedPlatforms: ["instagram"],
        cover: { assetId: 7, sourceCoreRevision: 1, createdAt: NOW },
        versions: [{ versionId: "", drafts: "broken" }],
      },
      NOW
    );
    expect(normalized.cover?.assetId).toBe(7);
    expect(normalized.versions?.[0].cover?.assetId).toBe(7);
  });

  it("fills missing canonical V1 fields from valid legacy formal cover and draft", () => {
    const normalized = normalizePublishingDraftState({
      activeVersionId: "v1", containerRevision: 1,
      activePlatform: "x", selectedPlatforms: ["x"],
      drafts: { x: { platform: "x", content: content("legacy valid draft") } },
      cover: { assetId: 91, sourceCoreRevision: 1, createdAt: NOW },
      versions: [{ versionId: "v1", sequence: 1, displayName: "V1", parentId: null,
        versionRevision: 1, core: null, drafts: {}, activePlatform: "x", selectedPlatforms: ["x"],
        narrativeIntent: {}, cover: null, coverRounds: [], conversationSnapshot: null }],
    }, NOW);
    expect(normalized.versions?.[0]?.drafts.x?.content.body).toBe("legacy valid draft");
    expect(normalized.versions?.[0]?.cover?.assetId).toBe(91);
  });

  it("keeps rejected intent proposals version-owned and ignores production history fields", () => {
    const normalized = normalizePublishingDraftState({
      activeVersionId: "v1", containerRevision: 1,
      versions: [{
        versionId: "v1", sequence: 1, displayName: "V1", parentId: null, versionRevision: 1,
        activePlatform: "x", selectedPlatforms: ["x"], drafts: {}, core: null,
        narrativeIntent: {}, cover: null, coverRounds: [], conversationSnapshot: null,
        intentProposals: [{ id: "p-rejected", status: "rejected", changes: { coreAudience: "public" }, evidence: [],
          createdAt: NOW, resolvedAt: NOW, source: { kind: "recognition", storyId: 7, versionId: "v1", intentRevision: 2 } }],
        productionFields: [{ id: 1 }], imageTakes: [{ id: 2 }], timelineHistory: [{ id: 3 }],
      }],
    }, NOW);
    expect(normalized.versions?.[0]?.intentProposals?.[0]).toMatchObject({ id: "p-rejected", status: "rejected" });
    expect(normalized.versions?.[0]).not.toHaveProperty("productionFields");
    expect(normalized.versions?.[0]).not.toHaveProperty("imageTakes");
    expect(normalized.versions?.[0]).not.toHaveProperty("timelineHistory");
  });

  it("does not resurrect an intentionally cleared canonical cover from stale top-level projection", () => {
    const normalized = normalizePublishingDraftState({
      canonicalAuthority: "versions", activeVersionId: "v1", containerRevision: 2,
      cover: { assetId: 99, sourceCoreRevision: 1, createdAt: NOW },
      versions: [{ versionId: "v1", sequence: 1, displayName: "V1", parentId: null,
        versionRevision: 2, core: null, drafts: {}, activePlatform: "x", selectedPlatforms: ["x"],
        narrativeIntent: {}, cover: null, coverRounds: [], conversationSnapshot: null }],
    }, NOW);
    expect(normalized.cover).toBeNull();
    expect(normalized.versions?.[0]?.cover).toBeNull();
  });

  it("derives every active top-level field from the canonical version", () => {
    const normalized = normalizePublishingDraftState(
      {
        canonicalAuthority: "versions",
        activeVersionId: "v1",
        containerRevision: 3,
        activePlatform: "x",
        selectedPlatforms: ["x"],
        core: { ...core(9), thesis: "stale top-level core" },
        drafts: {
          x: { platform: "x", content: content("stale top-level draft") },
        },
        cover: { assetId: 99, sourceCoreRevision: 9, createdAt: NOW },
        versions: [
          {
            versionId: "v1",
            sequence: 1,
            displayName: "V1",
            parentId: null,
            versionRevision: 3,
            core: { ...core(3), thesis: "canonical core" },
            drafts: {
              xiaohongshu: {
                platform: "xiaohongshu",
                content: content("canonical draft"),
              },
            },
            activePlatform: "xiaohongshu",
            selectedPlatforms: ["xiaohongshu"],
            narrativeIntent: {},
            cover: null,
            coverRounds: [],
            conversationSnapshot: null,
          },
        ],
      },
      NOW
    );

    expect(normalized.core?.thesis).toBe("canonical core");
    expect(normalized.drafts.x).toBeUndefined();
    expect(normalized.drafts.xiaohongshu?.content.body).toBe("canonical draft");
    expect(normalized.activePlatform).toBe("xiaohongshu");
    expect(normalized.cover).toBeNull();
  });

  it("migrates a non-active pending paid receipt to its owning version without projecting it", () => {
    const receipt = {
      operationToken: "paid-v1", versionId: "v1", status: "pending" as const,
      platform: "xiaohongshu" as const, referenceAssetId: null, feedback: "", prompt: "p", roundId: "r",
      taskId: "provider-task", claimedAt: NOW, updatedAt: NOW, expiresAt: NOW + 1000,
    };
    const version = (id: string, sequence: number) => ({
      versionId: id, sequence, displayName: id.toUpperCase(), parentId: sequence === 1 ? null : "v1",
      versionRevision: 1, core: null, drafts: {}, activePlatform: "x", selectedPlatforms: ["x"],
      narrativeIntent: {}, cover: null, coverRounds: [], conversationSnapshot: null,
    });
    const normalized = normalizePublishingDraftState({
      activeVersionId: "v2", containerRevision: 2, versions: [version("v1", 1), version("v2", 2)],
      coverGeneration: receipt,
    }, NOW);
    expect(normalized.versions?.find(v => v.versionId === "v1")?.coverGeneration).toMatchObject({ operationToken: "paid-v1", taskId: "provider-task" });
    expect(normalized.coverGeneration).toBeNull();
  });

  it("retains independent drafts, core revisions, active platform, and cover", () => {
    const raw = {
      version: 1,
      revision: 4,
      activePlatform: "x",
      selectedPlatforms: ["xiaohongshu", "x"],
      core: core(3),
      drafts: {
        xiaohongshu: {
          platform: "xiaohongshu",
          content: content("小红书版本", "小红书标题", ["工具"]),
          appliedBaseline: content("小红书版本", "小红书标题", ["工具"]),
          sourceCoreRevision: 2,
          revision: 7,
          needsReview: true,
          updatedAt: NOW - 100,
        },
        x: {
          platform: "x",
          content: content("X version", "", []),
          appliedBaseline: content("X version", "", []),
          sourceCoreRevision: 3,
          revision: 2,
          needsReview: false,
          updatedAt: NOW,
        },
      },
      cover: {
        assetId: 42,
        sourceCoreRevision: 3,
        createdAt: NOW,
      },
      coverRounds: [
        {
          id: "round-1",
          platform: "xiaohongshu",
          sourceCoreRevision: 3,
          parentAssetId: null,
          feedback: "",
          instructions: ["更多留白", "更多留白", "像风景画"],
          artReference: {
            label: "纸本参考",
            imageUrl: "/api/images/reference.png",
            style: ["纸本拼贴"],
            palette: ["矿物色"],
            light: [],
            composition: ["极端留白"],
            material: ["粗纸纤维"],
            mood: [],
          },
          assetIds: [51, 52, 53, 54],
          createdAt: NOW,
        },
      ],
      updatedAt: NOW,
    };

    const normalized = normalizePublishingDraftState(raw, NOW + 1);

    expect(normalized.core).toEqual(core(3));
    expect(normalized.activePlatform).toBe("x");
    expect(normalized.drafts.x?.content.body).toBe("X version");
    expect(normalized.drafts.xiaohongshu?.content.body).toBe("小红书版本");
    expect(normalized.drafts.xiaohongshu?.needsReview).toBe(true);
    expect(normalized.cover?.assetId).toBe(42);
    expect(normalized.coverRounds).toEqual([
      expect.objectContaining({
        id: "round-1",
        assetIds: [51, 52, 53, 54],
        instructions: ["更多留白", "像风景画"],
        artReference: expect.objectContaining({
          imageUrl: "/api/images/reference.png",
          palette: ["矿物色"],
        }),
      }),
    ]);
  });

  it("keeps each version video storyboard isolated from the formal activation pointer", () => {
    const raw = normalizePublishingDraftState(
      {
        ...emptyPublishingDraftState(NOW),
        activeVersionId: "v2",
        activeVideoStoryboardVersionId: "v1",
        activeVideoStoryboardGroupId: "publishing-group-v1",
        containerRevision: 2,
        versions: [
          {
            versionId: "v1",
            sequence: 1,
            displayName: "V1",
            parentId: null,
            versionRevision: 1,
            activePlatform: "xiaohongshu",
            selectedPlatforms: ["xiaohongshu"],
            drafts: {},
            cover: null,
            coverRounds: [],
            videoStoryboard: {
              version: 1,
              latestPreview: null,
              confirmed: null,
              impactPlan: null,
              operations: {},
            },
          },
          {
            versionId: "v2",
            sequence: 2,
            displayName: "V2",
            parentId: "v1",
            versionRevision: 2,
            activePlatform: "x",
            selectedPlatforms: ["x"],
            drafts: {},
            cover: null,
            coverRounds: [],
          },
        ],
      },
      NOW
    );

    expect(raw.activeVersionId).toBe("v2");
    expect(raw.activeVideoStoryboardVersionId).toBe("v1");
    expect(raw.activeVideoStoryboardGroupId).toBe("publishing-group-v1");
    expect(raw.versions?.[0]?.videoStoryboard).toMatchObject({ version: 1 });
    expect(raw.versions?.[1]?.videoStoryboard).toBeNull();
  });

  it("deduplicates selections and drops unsupported or malformed data without manufacturing text", () => {
    const normalized = normalizePublishingDraftState(
      {
        activePlatform: "myspace",
        selectedPlatforms: ["instagram", "instagram", "myspace", null, "x"],
        core: { facts: "not-an-array", thesis: 99 },
        drafts: {
          myspace: { content: content("do not keep") },
          instagram: { platform: "instagram", content: "broken" },
          x: {
            platform: "x",
            content: { title: 7, body: null, tags: ["", 1] },
          },
        },
        cover: { assetId: "not-a-number" },
        coverRounds: [
          {
            id: "broken-duplicates",
            platform: "xiaohongshu",
            sourceCoreRevision: 1,
            assetIds: [1, 1, 2, 3],
          },
          {
            id: "broken-count",
            platform: "x",
            sourceCoreRevision: 1,
            assetIds: [4, 5, 6, 7, 8],
          },
        ],
      },
      NOW
    );

    expect(normalized.activePlatform).toBe("instagram");
    expect(normalized.selectedPlatforms).toEqual(["instagram", "x"]);
    expect(Object.keys(normalized.drafts)).toEqual(["x"]);
    expect(normalized.drafts.x?.content).toEqual({
      title: "",
      body: "",
      tags: [],
    });
    expect(normalized.core).toEqual({
      revision: 0,
      facts: [],
      thesis: "",
      emotion: "",
      voiceTraits: [],
      visualConcept: "",
      updatedAt: NOW,
    });
    expect(normalized.cover).toBeNull();
    expect(normalized.coverRounds).toEqual([]);
  });

  it("keeps a non-empty clean subset after pixel QA quarantines provider candidates", () => {
    const normalized = normalizePublishingDraftState(
      {
        activePlatform: "xiaohongshu",
        selectedPlatforms: ["xiaohongshu"],
        coverRounds: [
          {
            id: "round-partial",
            platform: "xiaohongshu",
            sourceCoreRevision: 1,
            assetIds: [41, 44],
            qualityRejectedCount: 2,
            qualityCheckedAt: NOW - 50,
            createdAt: NOW,
          },
        ],
      },
      NOW
    );

    expect(normalized.coverRounds).toEqual([
      expect.objectContaining({
        id: "round-partial",
        assetIds: [41, 44],
        qualityRejectedCount: 2,
        qualityCheckedAt: NOW - 50,
      }),
    ]);
  });

  it("keeps flagged candidates in the round and drops flags that name no candidate", () => {
    const normalized = normalizePublishingDraftState(
      {
        activePlatform: "xiaohongshu",
        selectedPlatforms: ["xiaohongshu"],
        coverRounds: [
          {
            id: "round-flagged",
            platform: "xiaohongshu",
            sourceCoreRevision: 1,
            assetIds: [41, 42, 43, 44],
            qualityFlaggedAssetIds: [42, 42, 43, 99],
            qualityCheckedAt: NOW - 50,
            createdAt: NOW,
          },
        ],
      },
      NOW
    );

    expect(normalized.coverRounds).toEqual([
      expect.objectContaining({
        id: "round-flagged",
        assetIds: [41, 42, 43, 44],
        qualityFlaggedAssetIds: [42, 43],
        qualityCheckedAt: NOW - 50,
      }),
    ]);
  });

  it("preserves the never-inspected marker so it cannot read as a clean round", () => {
    const normalized = normalizePublishingDraftState(
      {
        activePlatform: "xiaohongshu",
        selectedPlatforms: ["xiaohongshu"],
        coverRounds: [
          {
            id: "round-unchecked",
            platform: "xiaohongshu",
            sourceCoreRevision: 1,
            assetIds: [41, 42, 43, 44],
            qualityCheckUnavailable: true,
            qualityCheckedAt: NOW - 10,
            createdAt: NOW,
          },
        ],
      },
      NOW
    );

    expect(normalized.coverRounds).toEqual([
      expect.objectContaining({
        id: "round-unchecked",
        qualityCheckUnavailable: true,
        qualityCheckedAt: NOW - 10,
      }),
    ]);
    expect(normalized.coverRounds[0]!.qualityFlaggedAssetIds).toBeUndefined();
  });

  it("normalizes older publishing state to an empty cover-round collection", () => {
    const normalized = normalizePublishingDraftState(
      {
        activePlatform: "xiaohongshu",
        selectedPlatforms: ["xiaohongshu"],
      },
      NOW
    );

    expect(normalized.coverRounds).toEqual([]);
  });

  it("keeps unopened selected platforms as metadata instead of creating drafts", () => {
    const normalized = normalizePublishingDraftState(
      {
        activePlatform: "xiaohongshu",
        selectedPlatforms: ["xiaohongshu", "x", "instagram"],
        drafts: {
          xiaohongshu: {
            platform: "xiaohongshu",
            content: content("只生成当前平台"),
          },
        },
      },
      NOW
    );

    expect(normalized.selectedPlatforms).toEqual([
      "xiaohongshu",
      "x",
      "instagram",
    ]);
    expect(Object.keys(normalized.drafts)).toEqual(["xiaohongshu"]);
  });
});

describe("publishing draft transitions", () => {
  it("adds one converted platform without changing an edited source draft", () => {
    const before = stateWithDrafts();
    const sourceBefore = JSON.stringify(before.drafts.xiaohongshu);

    const after = upsertPublishingPlatformDraft(before, {
      platform: "x",
      content: content("I am not afraid of AI. I am afraid of waste."),
      activate: true,
      now: NOW + 1,
    });

    expect(after.activePlatform).toBe("x");
    expect(after.drafts.x?.sourceCoreRevision).toBe(1);
    expect(JSON.stringify(after.drafts.xiaohongshu)).toBe(sourceBefore);
    expect(before.drafts.x).toBeUndefined();
  });

  it("applies wording-only edits to one draft without advancing the core", () => {
    const before = stateWithDrafts();
    const nextContent = content(
      "我只是调整了分段和措辞。",
      "别把时间交给噪音",
      ["AI工具"]
    );

    const after = applyPublishingWordingEdit(
      before,
      "xiaohongshu",
      nextContent,
      NOW + 1
    );

    expect(after.core?.revision).toBe(1);
    expect(after.drafts.xiaohongshu?.content).toEqual(nextContent);
    expect(after.drafts.xiaohongshu?.appliedBaseline).toEqual(nextContent);
    expect(after.drafts.xiaohongshu?.revision).toBe(2);
  });

  it("confirms a core revision without rewriting other platform text", () => {
    let before = stateWithDrafts();
    before = upsertPublishingPlatformDraft(before, {
      platform: "x",
      content: content("The existing X draft must stay byte-for-byte."),
      now: NOW,
    });
    const xTextBefore = JSON.stringify(before.drafts.x?.content);

    const after = confirmPublishingCoreChange(before, {
      platform: "xiaohongshu",
      nextCore: {
        facts: [...core().facts, "人类注意力才是最稀缺的成本"],
        thesis: "效率工具必须让人保有决定权",
        emotion: "清醒而坚定",
        voiceTraits: core().voiceTraits,
        visualConcept: core().visualConcept,
      },
      activeDraftContent: content("我改的不是措辞，而是判断。"),
      now: NOW + 1,
    });

    expect(after.core?.revision).toBe(2);
    expect(after.drafts.xiaohongshu?.sourceCoreRevision).toBe(2);
    expect(after.drafts.xiaohongshu?.needsReview).toBe(false);
    expect(after.drafts.x?.needsReview).toBe(true);
    expect(JSON.stringify(after.drafts.x?.content)).toBe(xTextBefore);
  });

  it("rejects unsupported platform identifiers at transition boundaries", () => {
    const before = stateWithDrafts();

    expect(() =>
      upsertPublishingPlatformDraft(before, {
        platform: "myspace" as PublishingPlatformId,
        content: content("unsupported"),
      })
    ).toThrow(/unsupported publishing platform/i);
  });
});
