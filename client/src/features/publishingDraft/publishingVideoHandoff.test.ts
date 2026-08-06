import { describe, expect, it } from "vitest";
import {
  emptyPublishingDraftState,
  upsertPublishingPlatformDraft,
} from "@shared/publishingDraft";
import {
  buildPublishingVideoHandoff,
  derivePublishingSpeechCandidates,
  latestPublishingDraftState,
} from "./publishingVideoHandoff";

describe("publishing video handoff", () => {
  it("prefers the newest same-Story publishing projection over a stale query", () => {
    const staleQuery = emptyPublishingDraftState(1);
    const currentSpine = upsertPublishingPlatformDraft(
      emptyPublishingDraftState(2),
      {
        platform: "x",
        content: { title: "最新", body: "当前发布稿", tags: [] },
        now: 3,
      }
    );

    expect(
      latestPublishingDraftState([staleQuery, currentSpine]).drafts.x?.content
        .body
    ).toBe("当前发布稿");
  });

  it("turns prose paragraphs into narration and explicit quotes into dialogue", () => {
    const result = derivePublishingSpeechCandidates({
      platform: "x",
      body: [
        "我真正担心的不是 AI 写得不够快。",
        "“人类最珍贵的判断，正在被浪费。”",
        "朋友：那我们还要不要继续用？",
        "工具没有错，但决定什么值得做仍然是人的责任。",
      ].join("\n\n"),
    });

    expect(result.narration.map(item => item.text)).toEqual([
      "我真正担心的不是 AI 写得不够快。",
      "工具没有错，但决定什么值得做仍然是人的责任。",
    ]);
    expect(result.dialogue.map(item => item.text)).toEqual([
      "“人类最珍贵的判断，正在被浪费。”",
      "朋友：那我们还要不要继续用？",
    ]);
    expect(result.dialogue.every(item => item.sourcePlatform === "x")).toBe(
      true
    );
  });

  it("projects the same Story core, active draft, cover, and review state without copying", () => {
    const base = emptyPublishingDraftState(1);
    const state = upsertPublishingPlatformDraft(base, {
      platform: "x",
      content: {
        title: "",
        body: "第一段旁白。\n\n“原样保留的台词。”",
        tags: [],
      },
      activate: true,
      now: 2,
    });
    state.core = {
      revision: 1,
      facts: ["Codex 会触发多余调用"],
      thesis: "真正稀缺的是人的判断",
      emotion: "警惕",
      voiceTraits: ["直接"],
      visualConcept: "人在巨大的调用洪流前停下来",
      updatedAt: 2,
    };
    state.drafts.x!.needsReview = true;

    const handoff = buildPublishingVideoHandoff({
      storyId: 17,
      publishing: state,
      coverAsset: {
        id: 91,
        imageUrl: "/api/images/cover.png",
        imageKey: "generated/cover.png",
      },
    });

    expect(handoff).toMatchObject({
      storyId: 17,
      versionId: "v1",
      containerRevision: expect.any(Number),
      versionRevision: expect.any(Number),
      sourcePlatform: "x",
      needsReview: true,
      core: { thesis: "真正稀缺的是人的判断" },
      draft: { body: "第一段旁白。\n\n“原样保留的台词。”" },
      cover: { id: 91 },
    });
    expect(handoff?.narrationCandidates[0].text).toBe("第一段旁白。");
    expect(handoff?.dialogueCandidates[0].text).toBe("“原样保留的台词。”");
  });

  it("hands off text without a cover and refuses to invent text without an active draft", () => {
    const state = upsertPublishingPlatformDraft(emptyPublishingDraftState(1), {
      platform: "xiaohongshu",
      content: { title: "标题", body: "正文", tags: [] },
      now: 2,
    });
    expect(
      buildPublishingVideoHandoff({
        storyId: 3,
        publishing: state,
        coverAsset: null,
      })?.cover
    ).toBeNull();
    expect(
      buildPublishingVideoHandoff({
        storyId: 3,
        publishing: emptyPublishingDraftState(1),
        coverAsset: {
          id: 1,
          imageUrl: "/cover.png",
          imageKey: null,
        },
      })
    ).toBeNull();
  });
});
