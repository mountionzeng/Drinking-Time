import { describe, expect, it } from "vitest";

import { storyBodyFromShiguang, type ShiguangStorySnapshot } from "./shiguangStoryImport";

const snapshot: ShiguangStorySnapshot = {
  sourceKey: "story:外婆的厨房",
  sourceRevision: "0123456789abcdef",
  title: "外婆的厨房",
  updatedAt: "2026-09-14T10:00:00.000Z",
  memories: [{
    id: "memory-1",
    text: "厨房里总有热气。",
    summary: "外婆做饭",
    people: ["外婆"],
    places: ["厨房"],
    createdAt: "2026-09-13T10:00:00.000Z",
  }],
  manuscript: {
    title: "外婆的厨房",
    generatedAt: "2026-09-14T10:00:00.000Z",
    chapters: [{ id: "chapter-1", title: "灶台边", memoryIds: ["memory-1"], content: [{ text: "这是整理后的第一章。" }, { photoId: "local-photo-1" }] }],
  },
};

describe("拾光家忆故事快照", () => {
  it("保留记忆、章节、人物地点和照片引用供电脑继续创作", () => {
    const body = storyBodyFromShiguang(snapshot);
    expect(body.cards.map(card => card.content)).toEqual(["厨房里总有热气。", "这是整理后的第一章。"]);
    expect(body.characters).toEqual([{ name: "外婆", role: "故事中的人物", oneLiner: "来自拾光家忆" }]);
    expect(body.shiguangImport).toEqual(snapshot);
    expect(body.shiguangImport.manuscript?.chapters[0].content).toContainEqual({ photoId: "local-photo-1" });
  });

  it("卡片身份由微信故事和原记忆身份稳定生成", () => {
    const first = storyBodyFromShiguang(snapshot);
    const second = storyBodyFromShiguang(snapshot);
    expect(first.cards.map(card => card.id)).toEqual(second.cards.map(card => card.id));
  });
});
