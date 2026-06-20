import { describe, expect, it } from "vitest";
import { buildStoryArtReferences } from "./storyArtReferences";
import type { ChatMessage, StoryCard, VisualCanvasItem } from "./types";

const card: StoryCard = {
  id: "card-1",
  title: "窗边的小草",
  content: "清晨看见小草开花",
  emotion: "踏实",
  sensoryDetails: ["白色小花", "窗外晨光"],
  createdAt: 1,
};

const visual: VisualCanvasItem = {
  id: "visual-1",
  title: "小草照片",
  imageUrl: "https://example.com/riff.jpg",
  originalImageUrl: "https://example.com/grass.jpg",
  source: "reference",
  cardId: "card-1",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  prompt: "",
  analysis: {
    objective: "窗边花盆里开花的小草",
    aesthetic: "清晨安静",
    visualStyle: ["柔和插图"],
    mood: ["踏实"],
    colorPalette: ["青绿", "米白"],
    composition: "主体偏侧",
    lighting: "晨光",
    promptDraft: "",
    negativePrompt: "",
    confidence: 0.9,
  },
  createdAt: 1,
};

describe("story art references", () => {
  it("selects relevant photos and cards, preserving the original image as fact", () => {
    const messages: ChatMessage[] = [
      {
        id: "m1",
        role: "user",
        content: "这是我练八段锦的照片",
        photoUrl: "https://example.com/body.jpg",
        timestamp: 1,
      },
    ];
    const references = buildStoryArtReferences({
      messages,
      cards: [card],
      visualCanvasItems: [visual],
      targetContent: "清晨窗边的小草开花",
      maxSelected: 2,
    });

    expect(references[0]).toMatchObject({
      id: "visual:visual-1",
      imageUrl: "https://example.com/grass.jpg",
      purpose: "both",
      selected: true,
    });
    expect(references.filter(reference => reference.selected)).toHaveLength(2);
  });
});
