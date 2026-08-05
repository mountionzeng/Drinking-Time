import { describe, expect, it } from "vitest";
import {
  emptyPublishingDraftState,
  upsertPublishingPlatformDraft,
} from "@shared/publishingDraft";
import {
  buildPublishableText,
  existingPublishingTabs,
  getPublishingEditorContent,
  getPublishingStatus,
  publishingContentEquals,
  publishingConvertTargets,
  publishingStoryScopeMatches,
  updatePublishingSelection,
} from "./publishingDraftViewModel";

const xiaohongshuContent = {
  title: "真正稀缺的不是 token",
  body: "我担心的不是 AI 写得不够快，而是人类的判断被浪费了。",
  tags: ["AI", "独立思考"],
};

describe("publishingDraftViewModel", () => {
  it("rejects async publishing results after the user switches Stories", () => {
    expect(publishingStoryScopeMatches(7, 7)).toBe(true);
    expect(publishingStoryScopeMatches(7, 8)).toBe(false);
    expect(publishingStoryScopeMatches(7, null)).toBe(false);
  });

  it("only exposes drafts that actually exist as retained tabs", () => {
    const state = upsertPublishingPlatformDraft(emptyPublishingDraftState(1), {
      platform: "xiaohongshu",
      content: xiaohongshuContent,
      now: 2,
    });
    const selected = updatePublishingSelection(state, {
      activePlatform: "xiaohongshu",
      selectedPlatforms: ["xiaohongshu", "x", "linkedin"],
    });

    expect(existingPublishingTabs(selected)).toEqual(["xiaohongshu"]);
    expect(publishingConvertTargets(selected)).toEqual(["x", "linkedin"]);
  });

  it("keeps an active dirty buffer separate from the accepted platform draft", () => {
    const state = upsertPublishingPlatformDraft(emptyPublishingDraftState(1), {
      platform: "xiaohongshu",
      content: xiaohongshuContent,
      now: 2,
    });
    const buffered = {
      ...xiaohongshuContent,
      body: `${xiaohongshuContent.body}\n\n这才是我真正介意的。`,
    };

    expect(
      getPublishingEditorContent({
        state,
        storyId: 9,
        platform: "xiaohongshu",
        buffers: {
          "9:xiaohongshu": {
            storyId: 9,
            platform: "xiaohongshu",
            content: buffered,
            updatedAt: 3,
          },
        },
      })
    ).toEqual(buffered);
    expect(state.drafts.xiaohongshu?.content).toEqual(xiaohongshuContent);
    expect(publishingContentEquals(buffered, xiaohongshuContent)).toBe(false);
  });

  it("formats only the active platform text for clipboard output", () => {
    expect(buildPublishableText(xiaohongshuContent)).toBe(
      "真正稀缺的不是 token\n\n我担心的不是 AI 写得不够快，而是人类的判断被浪费了。\n\n#AI #独立思考"
    );
    expect(
      buildPublishableText(
        {
          title: "X 不应复制独立标题",
          body: "1/2 第一条\n\n2/2 第二条",
          tags: ["AI"],
        },
        "x"
      )
    ).toBe("1/2 第一条\n\n2/2 第二条\n#AI");
    expect(
      buildPublishableText(
        { title: "", body: "第一条\n\n第二条", tags: [] },
        "x"
      )
    ).toBe("1/2 第一条\n\n2/2 第二条");
  });

  it("keeps the active platform selected and never mutates the source state", () => {
    const state = emptyPublishingDraftState(1);
    const next = updatePublishingSelection(state, {
      activePlatform: "x",
      selectedPlatforms: ["linkedin"],
    });

    expect(next.activePlatform).toBe("x");
    expect(next.selectedPlatforms).toEqual(["x", "linkedin"]);
    expect(state.activePlatform).toBe("xiaohongshu");
  });

  it("surfaces dirty, stale, and saved states without rewriting text", () => {
    const state = upsertPublishingPlatformDraft(emptyPublishingDraftState(1), {
      platform: "xiaohongshu",
      content: xiaohongshuContent,
      now: 2,
    });
    const draft = state.drafts.xiaohongshu!;

    expect(getPublishingStatus(draft, true)).toEqual({
      tone: "editing",
      label: "有未应用修改",
    });
    expect(getPublishingStatus({ ...draft, needsReview: true }, false)).toEqual(
      {
        tone: "review",
        label: "内核已变化，建议复核",
      }
    );
    expect(getPublishingStatus(draft, false)).toEqual({
      tone: "saved",
      label: "已保存",
    });
  });
});
