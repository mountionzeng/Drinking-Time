import { expect, it } from "vitest";
import { parseArtPreviewChat, readArtPreviewBatches } from "./artPreview";
it.each([
  ["用图片 #2038，结合当前台词和配乐，生成一组镜头示意图", { kind: "plan", imageId: 2038 }],
  ["沿用美术体系生成镜头示意图", { kind: "plan" }],
  ["查看之前的示意图", { kind: "show" }],
  ["恢复镜头示意图", { kind: "show" }],
  ["V02 第 2 镜用第 3 张", { kind: "choose", shotNo: 2, ordinal: 3, version: 2 }],
  ["第十镜选择第二张", { kind: "choose", shotNo: 10, ordinal: 2 }],
  ["V3 Shot 2 use image 4", { kind: "choose", shotNo: 2, ordinal: 4, version: 3 }],
])("routes %s", (input, expected) => expect(parseArtPreviewChat(input)).toMatchObject(expected));
it.each(["不要生成镜头示意图", "如何生成示意图", "把配乐调小", "修改第02镜图片要求：字幕不变", "第2镜用第3张生成视频", "don't generate storyboard previews"])("does not steal %s", text => expect(parseArtPreviewChat(text)).toBeNull());
it("ignores malformed history", () => expect(readArtPreviewBatches({ artPreviewBatches: [null, {}, "x"] })).toEqual([]));
