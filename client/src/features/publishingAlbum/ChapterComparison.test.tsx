import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Chapter } from "./useChapters";
import { ChapterComparison } from "./ChapterComparison";
vi.stubGlobal("React", React);
vi.mock("./ChapterWorkspace", () => ({ mapChapterImages: (value: unknown) => value }));
const content = (body: string, name: string, note?: string): Pick<Chapter, "title" | "blocks" | "layout"> => ({ title: "纸船", layout: null, blocks: { body, blockIds: ["one"], containsAiText: false, settings: null, coverKey: null, bodyTextureKey: null, illustrations: [], images: {}, attribution: { editorName: name, action: "edited" as const, ...(note ? { changeNote: note } : {}) } } });
it("shows both editors, writer supplied notes and marked additions/removals", () => {
  const html = renderToStaticMarkup(<ChapterComparison current={content("蓝色纸船", "小禾")} candidate={content("红色纸船", "Jane", "我改了颜色")} currentUrls={{}} candidateUrls={{}} />);
  expect(html).toContain("小禾"); expect(html).toContain("Jane"); expect(html).toContain("我改了颜色");
  expect(html).toMatch(/<del[^>]*>红<\/del>/); expect(html).toMatch(/<mark[^>]*>蓝<\/mark>/);
  expect(html).not.toContain("修改摘要");
});
it("does not invent a note when neither writer supplied one", () => {
  const html = renderToStaticMarkup(<ChapterComparison current={content("原文", "小禾")} candidate={content("原文", "Jane")} currentUrls={{}} candidateUrls={{}} candidateLabel="历史版本 2" />);
  expect(html).toContain("历史版本 2"); expect(html).toContain("正文没有变化");
  expect(html).not.toContain("<del"); expect(html).not.toContain("<mark");
});
it("text view shows changed words without images or layout controls", () => {
  const current = content("蓝色纸船", "小禾");
  current.blocks.coverKey = "cover";
  const html = renderToStaticMarkup(<ChapterComparison mode="text" current={current} candidate={content("红色纸船", "Jane")} currentUrls={{ cover: "https://example.com/cover.png" }} candidateUrls={{}} />);
  expect(html).toMatch(/<del[^>]*>红<\/del>/);
  expect(html).not.toContain("<img");
  expect(html).not.toContain("未编排");
});
it("image view shows image roles without a second plain-text comparison", () => {
  const current = content("仅在排版里显示的正文", "小禾");
  current.blocks.coverKey = "cover";
  const html = renderToStaticMarkup(<ChapterComparison mode="images" current={current} candidate={content("另一版正文", "Jane")} currentUrls={{ cover: "https://example.com/cover.png" }} candidateUrls={{}} />);
  expect(html).toContain("当前章节的封面");
  expect(html).toContain("对比图片及排版");
  expect(html).not.toContain("仅在排版里显示的正文");
  expect(html).not.toContain("另一版正文");
});
