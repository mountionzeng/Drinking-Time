import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { ChapterTextVersions } from "./ChapterTextVersions";
vi.stubGlobal("React", React);
const state = vi.hoisted(() => ({ chapters: [] as Array<{ id: number; title: string }>, pending: false }));
vi.mock("@/lib/trpc", () => ({ trpc: { chapters: {
  list: { useQuery: () => ({ data: state.chapters, isPending: state.pending }) },
  get: { useQuery: () => ({ data: state.chapters.length ? { chapter: { version: 23, blocks: { attribution: { editorName: "小禾" } } } } : undefined }) },
  versions: { useQuery: () => ({ data: state.chapters.length ? [{ version: 22, createdAt: new Date("2026-10-27"), attribution: { editorName: "Jane", changeNote: "我改了颜色" } }] : [], isPending: false }) },
  version: { useQuery: () => ({ data: undefined }) },
} } }));
vi.mock("./ChapterComparison", () => ({ ChapterComparison: () => null }));
beforeEach(() => { state.chapters = []; state.pending = false; });
it("shows a readable empty state without creating a chapter", () => {
  expect(renderToStaticMarkup(<ChapterTextVersions storyId={113} />)).toContain("还没有章节版本");
});
it("reads the chapter history and its manual notes without mounting image editing", () => {
  state.chapters = [{ id: 1, title: "纸船" }, { id: 2, title: "灯塔" }];
  const html = renderToStaticMarkup(<ChapterTextVersions storyId={113} />);
  for (const text of ["文字版本与对比", "纸船", "灯塔", "Jane", "我改了颜色", "打开对比", "小禾"]) expect(html).toContain(text);
  expect(html).not.toContain("<img");
  expect(html).not.toContain("生成图片");
});
it("reports loading instead of an empty history", () => {
  state.pending = true;
  const html = renderToStaticMarkup(<ChapterTextVersions storyId={113} />);
  expect(html).toContain("正在读取章节");
  expect(html).not.toContain("还没有章节版本");
});
