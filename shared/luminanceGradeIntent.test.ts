import { describe, expect, it } from "vitest";
import { luminanceImageReply, luminanceVideoReply, parseLuminanceGradeIntent } from "./luminanceGradeIntent";
import { parseColorTransferIntent } from "./colorTransferIntent";
import { parseArtSystemChat } from "./artSystemChat";

describe("parseLuminanceGradeIntent — free brightness-only grade", () => {
  it.each([
    ["按图片 #2045 的亮度调图片 #2047", { kind: "image", reference: { kind: "image", imageId: 2045 }, targets: [{ kind: "image", imageId: 2047 }], strengths: ["mid", "full"] }],
    ["图2只调亮度，参考图1", { kind: "image", reference: { kind: "ordinal", index: 1 }, targets: [{ kind: "ordinal", index: 2 }] }],
    ["把图片 #2047 调亮一点，色相和饱和度不变", { kind: "image", targets: [{ kind: "image", imageId: 2047 }] }],
    ["图片 #2047 只调亮度，中档", { kind: "image", targets: [{ kind: "image", imageId: 2047 }], strengths: ["mid"] }],
    ["图片 #2047 的亮度和图片 #2045 一样亮", { kind: "image", reference: { kind: "image", imageId: 2045 }, targets: [{ kind: "image", imageId: 2047 }], strengths: ["full"] }],
    ["第 3 镜只调亮度，按图片 #2045 的亮度", { kind: "image", reference: { kind: "image", imageId: 2045 }, targets: [{ kind: "shot", shotNo: 3 }] }],
    ["只调亮度", { kind: "image", targets: [] }],
  ])("image: %s", (text, expected) => {
    expect(parseLuminanceGradeIntent(text)).toMatchObject(expected);
  });

  it.each([
    ["视频 Take 1611 只调亮度", { kind: "video", takeId: 1611, strengths: ["mid", "full"] }],
    ["take 1611 太暗了，按图片 #2045 的亮度提亮，颜色别动", { kind: "video", takeId: 1611, referenceImageId: 2045 }],
    ["第 3 镜的视频太暗了，提亮一点，颜色别动", { kind: "video", shotNo: 3 }],
    ["视频只调亮度，全档", { kind: "video", strengths: ["full"] }],
  ])("video: %s", (text, expected) => {
    expect(parseLuminanceGradeIntent(text)).toMatchObject(expected);
  });

  it.each([
    "把树改绿，亮一点",
    "云层厚一点，再调亮",
    "亮一点，饱和度高一点",
    "按图一的颜色改图二",
    "把颜色改暖一点",
    "第 3 镜生成视频，亮一点",
    "为什么视频这么暗？",
    "亮度怎么调吗",
    "不要调亮",
    "森林的树木品种太少了，而且我希望最后云层会比较厚",
    "",
  ])("not a brightness-only request (falls back to the normal flow): %s", text => {
    expect(parseLuminanceGradeIntent(text)).toBeNull();
  });

  it("asks instead of guessing", () => {
    expect(parseLuminanceGradeIntent("按图片 #2045 的亮度和图片 #2046 的亮度调图片 #2047")).toMatchObject({ kind: "ask" });
    expect(parseLuminanceGradeIntent("按图片 #2047 的亮度调图片 #2047")).toMatchObject({ kind: "ask", question: expect.stringMatching(/同一张/) });
  });

  it("palette transfer and the art-system parser do not swallow brightness requests, and vice versa", () => {
    for (const text of ["按图片 #2045 的亮度调图片 #2047", "视频 Take 1611 只调亮度"]) {
      expect(parseColorTransferIntent(text)).toBeNull();
      expect(parseArtSystemChat(text)).toBeNull();
    }
    expect(parseLuminanceGradeIntent("按图一的颜色改图二图三")).toBeNull();
  });
});

describe("replies", () => {
  it("image reply: 0 算力, original kept, both candidates offered, no auto replace", () => {
    const reply = luminanceImageReply({ results: [
      { status: "ok", targetImageId: 2047, referenceImageId: 2045, shotNo: 3, awaitingDecision: true,
        candidates: [{ imageId: 3001, strength: "mid", metrics: { lMeanBefore: 91.29, lMeanAfter: 87.89, hueP95Deg: 3.6, hslSMeanBefore: 0.29, hslSMeanAfter: 0.29 } }, { imageId: 3002, strength: "full" }] },
      { status: "error", targetImageId: 2046, target: "图片 #2046", error: "文件不在本机" },
    ] });
    expect(reply).toContain("0 算力");
    expect(reply).toContain("原图保留");
    expect(reply).toContain("中档 #3001（L 91.29→87.89）");
    expect(reply).toContain("「图片 #3001 替换原图」或「图片 #3002 替换原图」");
    expect(reply).toContain("第 3 镜保留原图");
    expect(reply).toContain("图片 #2046没有调整");
  });

  it("video reply: new takes listed, not placed", () => {
    const reply = luminanceVideoReply([
      { takeId: 1700, parentTakeId: 1611, shotNo: 3, referenceImageId: 2045, strength: "mid", metrics: { lMeanBefore: 60, lMeanAfter: 70, referenceBodyLMean: 84 } },
      { takeId: 1701, parentTakeId: 1611, shotNo: 3, referenceImageId: 2045, strength: "full" },
    ]);
    expect(reply).toContain("0 算力");
    expect(reply).toContain("原 Take 保留");
    expect(reply).toContain("「采用视频 Take 1700」或「采用视频 Take 1701」");
  });
});
