import { describe, expect, it } from "vitest";

import {
  PUBLISHING_PLATFORM_IDS,
  PUBLISHING_PLATFORM_REGISTRY,
  applyPublishingWordingEdit,
  confirmPublishingCoreChange,
  emptyPublishingDraftState,
  getPublishingContentError,
  getXThreadStats,
  numberXThreadPosts,
  normalizePublishingDraftState,
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

describe("normalizePublishingDraftState", () => {
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
      }),
    ]);
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
            assetIds: [4, 5, 6],
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
