import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { ShotTextTrial } from "@shared/shotTextTrial";
import { ManuscriptRows } from "./ShotManuscriptReader";

vi.stubGlobal("React", React);
const first = {
  id: "ref", shotId: "first", shotNo: 1, state: "reference", text: "**原句**\n送到河边码头。",
  request: "", createdAt: 1, source: "YouMind",
} satisfies ShotTextTrial & { shotNo: number };
it("keeps a readable version open during generation and orders shots by their current numbers", () => {
  const html = renderToStaticMarkup(<ManuscriptRows rows={[
    { ...first, id: "second", shotNo: 2, shotId: "second", state: "failed" },
    { ...first, id: "source", state: "source", text: "底稿资料" },
    { ...first, id: "pending", state: "writing", text: "", request: "最后三秒留白", createdAt: 2 },
    first,
  ]} />);
  expect(html.indexOf("第 01 镜")).toBeLessThan(html.indexOf("第 02 镜"));
  expect(html).toMatch(/<details open=""[^>]*><summary[^>]*>YouMind · 参考稿 · 未采用/);
  expect(html).toContain("<strong>");
  expect(html).toContain("送到河边码头。");
  expect(html).toContain("最后三秒留白");
  expect(html).not.toContain("底稿资料");
});
it("features the newest independent draft and retains both the older draft and the external reference", () => {
  const html = renderToStaticMarkup(<ManuscriptRows rows={[
    first,
    { ...first, id: "old", state: "ready", createdAt: 2, source: "旧稿", text: "上一稿" },
    { ...first, id: "new", state: "ready", createdAt: 3, source: "拾光", text: "最新试稿" },
  ]} />);
  expect(html).toMatch(/<details open=""[^>]*><summary[^>]*>拾光 · 文字试稿 · 未采用/);
  expect(html).toContain("上一稿");
  expect(html).toContain("YouMind");
});
