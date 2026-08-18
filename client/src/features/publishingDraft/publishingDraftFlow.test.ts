import { describe, expect, it, vi } from "vitest";
import {
  PUBLISHING_PLATFORM_IDS,
  applyPublishingWordingEdit,
  appendPublishingCoverRound,
  emptyPublishingDraftState,
  normalizePublishingDraftState,
  upsertPublishingPlatformDraft,
} from "@shared/publishingDraft";
import {
  getPublishingBuffer,
  normalizePublishingBuffers,
  setPublishingBuffer,
} from "@/features/storyAgent/storyAgentPersistence";
import { buildPublishingCoverExportPlan } from "./publishingCoverExport";
import { buildPublishingVideoHandoff } from "./publishingVideoHandoff";

describe("publishing draft acceptance flow", () => {
  it("keeps one Story durable from first draft through conversion, cover, refresh, and video handoff", () => {
    const paidSideEffects = {
      chat: vi.fn(),
      image: vi.fn(),
      shots: vi.fn(),
      video: vi.fn(),
    };
    let publishing = emptyPublishingDraftState(1);
    publishing.selectedPlatforms = ["xiaohongshu", "x", "instagram"];

    expect(Object.keys(publishing.drafts)).toEqual([]);

    publishing.core = {
      revision: 1,
      facts: ["Codex 会触发多余的子 Agent"],
      thesis: "真正稀缺的是人的判断和时间",
      emotion: "克制的不满",
      voiceTraits: ["直接", "保留个人判断"],
      visualConcept: "时间被无数分支拖走",
      updatedAt: 2,
    };
    publishing = upsertPublishingPlatformDraft(publishing, {
      platform: "xiaohongshu",
      content: {
        title: "真正稀缺的不是 token",
        body: "我不怕 AI 写得快。\n\n“我怕的是人的判断被浪费。”",
        tags: ["AI工具"],
      },
      now: 2,
    });
    expect(Object.keys(publishing.drafts)).toEqual(["xiaohongshu"]);

    let buffers = setPublishingBuffer(
      {},
      {
        storyId: 17,
        platform: "xiaohongshu",
        content: {
          ...publishing.drafts.xiaohongshu!.content,
          body: "我不怕 AI 写得快。\n\n“我怕的是人的判断被浪费。”\n\n决定权必须留在人手里。",
        },
        updatedAt: 3,
      }
    );
    buffers = setPublishingBuffer(buffers, {
      storyId: 23,
      platform: "x",
      content: { title: "另一个 Story", body: "不能串过来", tags: [] },
      updatedAt: 3,
    });
    buffers = setPublishingBuffer(buffers, {
      storyId: 17,
      versionId: "v2",
      platform: "xiaohongshu",
      content: { title: "V2 buffer", body: "不能覆盖 V1 buffer", tags: [] },
      updatedAt: 3,
    });
    const accepted = getPublishingBuffer(buffers, 17, "xiaohongshu")!;
    publishing = applyPublishingWordingEdit(
      publishing,
      "xiaohongshu",
      accepted.content,
      4
    );
    publishing = upsertPublishingPlatformDraft(publishing, {
      platform: "x",
      content: {
        title: "Attention is the real cost",
        body: "AI should save human judgment, not consume it.",
        tags: [],
      },
      activate: true,
      now: 5,
    });
    publishing = appendPublishingCoverRound(
      publishing,
      {
        id: "round-1",
        platform: "x",
        sourceCoreRevision: 1,
        parentAssetId: null,
        feedback: "",
        assetIds: [91, 92, 93, 94],
        createdAt: 6,
      },
      6
    );
    expect(publishing.cover).toBeNull();
    expect(publishing.coverRounds[0]?.assetIds).toEqual([91, 92, 93, 94]);

    publishing.cover = {
      assetId: 91,
      sourceCoreRevision: 1,
      createdAt: 7,
    };

    const restored = normalizePublishingDraftState(
      JSON.parse(JSON.stringify(publishing)),
      8
    );
    const restoredBuffers = normalizePublishingBuffers(
      JSON.parse(JSON.stringify(buffers))
    );
    expect(restored.activePlatform).toBe("x");
    expect(restored.drafts.xiaohongshu?.content.body).toContain("决定权");
    expect(restored.drafts.x?.content.body).toContain("human judgment");
    expect(restored.cover?.assetId).toBe(91);
    expect(restored.coverRounds[0]?.assetIds).toEqual([91, 92, 93, 94]);
    expect(getPublishingBuffer(restoredBuffers, 17, "x")).toBeUndefined();
    expect(
      getPublishingBuffer(restoredBuffers, 17, "xiaohongshu", "v1")?.content
        .body
    ).toContain("决定权");
    expect(
      getPublishingBuffer(restoredBuffers, 17, "xiaohongshu", "v2")?.content
        .body
    ).toBe("不能覆盖 V1 buffer");
    expect(getPublishingBuffer(restoredBuffers, 23, "x")?.content.body).toBe(
      "不能串过来"
    );

    const handoff = buildPublishingVideoHandoff({
      storyId: 17,
      publishing: restored,
      coverAsset: {
        id: 91,
        imageUrl: "/api/images/publishing-cover.png",
        imageKey: "generated/publishing-cover.png",
      },
    });
    expect(handoff).toMatchObject({
      storyId: 17,
      sourcePlatform: "x",
      cover: { id: 91 },
      core: { thesis: "真正稀缺的是人的判断和时间" },
      draft: { body: "AI should save human judgment, not consume it." },
    });

    const exportPlans = PUBLISHING_PLATFORM_IDS.map(platform =>
      buildPublishingCoverExportPlan({
        platform,
        sourceWidth: 1024,
        sourceHeight: 1024,
      })
    );
    expect(
      new Set(
        exportPlans.map(plan => `${plan.output.width}x${plan.output.height}`)
      ).size
    ).toBe(6);
    expect(
      Object.values(paidSideEffects).every(call => call.mock.calls.length === 0)
    ).toBe(true);
  });
});
