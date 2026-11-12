import { describe, expect, it } from "vitest";
import {
  colorTransferReply,
  parseColorTransferIntent,
  parseSmallNumber,
  resolveColorTransferRefs,
} from "./colorTransferIntent";

const transfer = (text: string) => {
  const intent = parseColorTransferIntent(text);
  if (intent?.kind !== "transfer") throw new Error(`not a transfer: ${text} → ${JSON.stringify(intent)}`);
  const short = (r: (typeof intent)["source"]) => r.kind === "image" ? `#${r.imageId}` : r.kind === "shot" ? `镜${r.shotNo}` : `图${r.index}`;
  return { source: short(intent.source), targets: intent.targets.map(short) };
};

describe("parseColorTransferIntent — free local color transfer", () => {
  it.each([
    ["按照图一的颜色改图二图三", "图1", ["图2", "图3"]],
    ["按图1的颜色改图2和图3", "图1", ["图2", "图3"]],
    ["用图片 #2045 的色调改第 2、3 镜", "#2045", ["镜2", "镜3"]],
    ["沿用第一张的配色套到第二张和第三张", "图1", ["图2", "图3"]],
    ["把图二图三改成图一的颜色", "图1", ["图2", "图3"]],
    ["图二、图三的颜色改成和图一一样", "图1", ["图2", "图3"]],
    ["按图片#2045的颜色改#2046、#2047", "#2045", ["#2046", "#2047"]],
    ["按图一的色彩改图二，其他都不要动", "图1", ["图2"]],
    ["按图一的颜色改图二，不要改形状", "图1", ["图2"]],
    ["把第3镜的色调改成第1镜的", "镜1", ["镜3"]],
    ["use the colors of image 1 for images 2 and 3", "图1", ["图2", "图3"]],
    ["match image 2 and 3 to image 1's colors", "图1", ["图2", "图3"]],
    ["按图１的颜色改图２", "图1", ["图2"]],
  ])("%s", (text, source, targets) => {
    expect(transfer(text)).toEqual({ source, targets });
  });

  it("「第二章和第三章用第一章的颜色」(voice homophone) is read as 第N张 and flagged", () => {
    const intent = parseColorTransferIntent("第二章和第三章用第一章的颜色");
    expect(intent).toMatchObject({ kind: "transfer", source: { kind: "ordinal", index: 1, homophone: true } });
    expect(intent?.kind === "transfer" && intent.targets.map(t => t.kind === "ordinal" && t.index)).toEqual([2, 3]);
  });

  it.each([
    "把颜色改暖一点",
    "颜色不对，把树改绿",
    "按图一的风格改图二",
    "按图一的颜色改图二，并把树画清楚",
    "按图一的颜色改图二，云的形状明显一点",
    "按图一改图二",
    "统一配色",
    "调色",
    "按图一的颜色改图二，亮一点",
    "按图一的颜色改图二，暖一点",
    "按图一的颜色改图二，再加一只鸟",
    "图一的颜色好看吗",
    "按图片 #2045 的颜色重新生成图片 #2046",
    "",
  ])("not free (falls back to the quoted flow): %s", text => {
    expect(parseColorTransferIntent(text)).toBeNull();
  });

  it.each([
    ["按图一的颜色改一下", /要把哪几张/],
    ["按图一的颜色改图一", /同一张/],
    ["按图一的颜色改图二到图四", /逐张列出/],
    ["按图一的颜色和图二的色调改图三", /只能按一张图/],
    ["按图一的颜色改图2和图片 #2047", /混在一起/],
  ])("ambiguous → ask, never execute: %s", (text, question) => {
    const intent = parseColorTransferIntent(text);
    expect(intent?.kind).toBe("ask");
    expect(intent?.kind === "ask" && intent.question).toMatch(question);
    expect(intent?.kind === "ask" && intent.question).toMatch(/还没有调色/);
  });

  it("parses small Chinese numbers", () => {
    expect(["一", "二", "两", "十", "十二", "二十", "二十三", "7"].map(parseSmallNumber)).toEqual([1, 2, 2, 10, 12, 20, 23, 7]);
    expect(parseSmallNumber("一一")).toBeNull();
  });
});

describe("resolveColorTransferRefs — 图N follows the chat reference basket", () => {
  const basket = [{ imageId: 2045 }, { imageId: 2046 }, { imageId: 2047 }];
  const intentOf = (text: string) => {
    const intent = parseColorTransferIntent(text);
    if (intent?.kind !== "transfer") throw new Error(text);
    return intent;
  };

  it("maps 图1/图2/图3 to the basket order", () => {
    expect(resolveColorTransferRefs(intentOf("按照图一的颜色改图二图三"), basket)).toMatchObject({
      ok: true, source: { imageId: 2045 }, targets: [{ imageId: 2046 }, { imageId: 2047 }],
    });
  });

  it("says which 章 was read as 张", () => {
    const resolved = resolveColorTransferRefs(intentOf("第二章和第三章用第一章的颜色"), basket);
    expect(resolved.ok && resolved.mapping).toContain("按第 1 张理解");
  });

  it("asks when the basket cannot answer", () => {
    const empty = resolveColorTransferRefs(intentOf("按图一的颜色改图二"), []);
    expect(empty).toMatchObject({ ok: false });
    expect(!empty.ok && empty.question).toMatch(/引用栏里还没有图/);
    const short = resolveColorTransferRefs(intentOf("按图一的颜色改图四"), basket);
    expect(!short.ok && short.question).toMatch(/只有 3 张图/);
  });

  it("passes image ids and shot numbers through for the server to verify", () => {
    expect(resolveColorTransferRefs(intentOf("用图片 #2045 的色调改第 2、3 镜"), [])).toMatchObject({
      ok: true, source: { imageId: 2045 }, targets: [{ shotNo: 2 }, { shotNo: 3 }],
    });
  });
});

describe("colorTransferReply", () => {
  it("states 0 算力, keeps the original, and offers 替换原图 / 保留原图", () => {
    const reply = colorTransferReply({
      sourceImageId: 2045,
      results: [
        { status: "ok", targetImageId: 2046, imageId: 3001, imageUrl: "/api/images/a.png", shotNo: 2, awaitingDecision: true },
        { status: "error", targetImageId: 2047, target: "图片 #2047", error: "文件不在本机" },
      ],
    });
    expect(reply).toContain("0 算力");
    expect(reply).toContain("原图保留");
    expect(reply).toContain("图片 #3001 替换原图");
    expect(reply).toContain("第 2 镜保留原图");
    expect(reply).toContain("图片 #2047没有调色");
  });
});

describe("color transfer vs art system routing", () => {
  it("美术体系解析器不吞调色句，但仍识别真正的美术体系请求", async () => {
    const { parseArtSystemChat } = await import("./artSystemChat");
    for (const text of ["按图一的色调改图二图三", "照图1的色彩调一下图2", "按照图一的颜色改图二图三"]) {
      expect(parseArtSystemChat(text)).toBeNull();
      expect(parseArtSystemChat(text, true)).toBeNull();
    }
    expect(parseArtSystemChat("帮我建立这部作品的美术体系")).not.toBeNull();
  });
});
