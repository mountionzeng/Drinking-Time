import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { GeneratedImageItem } from "@/features/storyAgent/storyTypes";
import { CardReferenceDock } from "./CardReferenceDock";

vi.mock("@/features/storyAgent/spine/selectors", () => ({
  useCardReferenceDockSlice: () => ({
    isArtWorking: false,
    artDirection: { references: [] },
  }),
}));

vi.mock("@/features/storyAgent/StoryAgentContext", () => ({
  useStoryAgentActions: () => ({
    addVisualReference: vi.fn(),
    removeVisualCanvasItem: vi.fn(),
    setCharacterReferenceByUrl: vi.fn(),
  }),
}));

describe("CardReferenceDock", () => {
  it("renders the empty reference drop target", () => {
    const markup = renderToStaticMarkup(
      createElement(CardReferenceDock, {
        cardId: "card-1",
        visualItems: [],
      })
    );

    expect(markup).toContain("故事材料");
    expect(markup).toContain("添加参考");
    expect(markup).toContain("把与这一刻有关的照片拖进来");
  });

  it("renders the selected generated image and rationale", () => {
    const generatedImage: GeneratedImageItem = {
      id: 22,
      imageUrl: "/api/images/shot-22.webp",
      prompt: "雨夜车站",
      storyId: 7,
      status: "ready",
    };
    const markup = renderToStaticMarkup(
      createElement(CardReferenceDock, {
        cardId: "card-1",
        visualItems: [],
        generatedImage,
        imageRationale: "这一帧承担人物第一次犹豫。",
      })
    );

    expect(markup).toContain('src="/api/images/shot-22.webp"');
    expect(markup).toContain("这一帧承担人物第一次犹豫。");
    expect(markup).toContain("删除已选择画面");
    expect(markup).toContain("设为主角");
  });
});
