import { describe, expect, it } from "vitest";

import {
  buildPublishingAlbumLayout,
  publishingAlbumContrastForPoints,
  publishingAlbumGraphemes,
  type PublishingAlbumFontMetrics,
} from "./publishingAlbumLayout";

const metrics: PublishingAlbumFontMetrics = {
  isLoaded: () => true,
  supportsText: () => true,
  measure: (grapheme, _fontId, fontSize) => grapheme === "，" || grapheme === "。"
    ? fontSize * 0.9
    : fontSize,
};

const wideRegion = {
  kind: "region" as const,
  shape: "rectangle" as const,
  direction: "horizontal" as const,
  region: { x: 0.08, y: 0.15, width: 0.84, height: 0.7 },
  points: [{ x: 0.08, y: 0.15 }, { x: 0.92, y: 0.15 }, { x: 0.92, y: 0.85 }, { x: 0.08, y: 0.85 }],
};

describe("publishing album layout", () => {
  it("segments Chinese punctuation, emoji, surrogate pairs and combining marks as graphemes", () => {
    const text = "你，好👨‍👩‍👧‍👦𠀀é\n再见";
    const graphemes = publishingAlbumGraphemes(text);
    expect(graphemes).toContain("👨‍👩‍👧‍👦");
    expect(graphemes).toContain("𠀀");
    expect(graphemes).toContain("é");
    expect(graphemes.join("")).toBe(text);
  });

  it("lays all graphemes into a wide horizontal region without truncation", () => {
    const text = "雨停了，院子里只剩一把旧椅子。";
    const result = buildPublishingAlbumLayout({
      text, fontId: "noto-serif-sc", geometry: wideRegion,
      canvas: { width: 900, height: 1200 }, alignment: "center", metrics,
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.plan.kind).toBe("region");
      expect(result.plan.graphemes.map(item => item.grapheme).join("")).toBe(text);
      expect(result.plan.fontSize).toBeGreaterThanOrEqual(18);
    }
  });

  it("honors an explicit font size and letter spacing in the shared layout plan", () => {
    const result = buildPublishingAlbumLayout({
      text: "调整字距",
      fontId: "noto-serif-sc",
      geometry: wideRegion,
      canvas: { width: 900, height: 1200 },
      fontSize: 42,
      letterSpacing: 12,
      lineSpacing: 1.3,
      metrics,
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.plan.fontSize).toBe(42);
      expect(result.plan.letterSpacing).toBe(12);
      expect(result.plan.graphemes[1]!.x - result.plan.graphemes[0]!.x).toBe(54);
    }
  });

  it("flows a narrow tall region vertically from right to left", () => {
    const text = "山高水长，后会有期。";
    const result = buildPublishingAlbumLayout({
      text, fontId: "zcool-xiaowei",
      geometry: {
        ...wideRegion,
        direction: "vertical",
        region: { x: 0.25, y: 0.05, width: 0.5, height: 0.9 },
      },
      canvas: { width: 600, height: 1200 }, metrics,
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.plan.graphemes.map(item => item.grapheme).join("")).toBe(text);
      expect(result.plan.graphemes[0]!.x).toBeGreaterThanOrEqual(result.plan.graphemes.at(-1)!.x);
    }
  });

  it("keeps all path text and follows the direction when points reverse", () => {
    const text = "沿着风走";
    const forwardGeometry = {
      kind: "path" as const,
      points: [{ x: 0.1, y: 0.7 }, { x: 0.45, y: 0.25 }, { x: 0.9, y: 0.35 }],
    };
    const reverseGeometry = { kind: "path" as const, points: [...forwardGeometry.points].reverse() };
    const forward = buildPublishingAlbumLayout({
      text, fontId: "zhi-mang-xing", geometry: forwardGeometry,
      canvas: { width: 1000, height: 1000 }, metrics,
    });
    const reverse = buildPublishingAlbumLayout({
      text, fontId: "zhi-mang-xing", geometry: reverseGeometry,
      canvas: { width: 1000, height: 1000 }, metrics,
    });
    expect(forward.status).toBe("ok");
    expect(reverse.status).toBe("ok");
    if (forward.status === "ok" && reverse.status === "ok") {
      expect(forward.plan.graphemes.map(item => item.grapheme).join("")).toBe(text);
      expect(reverse.plan.graphemes.map(item => item.grapheme).join("")).toBe(text);
      expect(forward.plan.graphemes[0]!.x).toBeLessThan(reverse.plan.graphemes[0]!.x);
      expect(forward.plan.graphemes[0]!.rotation).not.toBe(reverse.plan.graphemes[0]!.rotation);
    }
  });

  it("returns overflow at the readable minimum instead of ellipsis or truncation", () => {
    const text = "这段文字绝对不能被悄悄截断。".repeat(30);
    const result = buildPublishingAlbumLayout({
      text, fontId: "noto-sans-sc",
      geometry: { ...wideRegion, region: { x: 0.4, y: 0.4, width: 0.2, height: 0.12 } },
      canvas: { width: 600, height: 800 }, metrics,
    });
    expect(result).toEqual({
      status: "overflow", reason: "text_does_not_fit",
      suggestion: "文字在可读字号下放不完，请重画更大的区域",
    });
  });

  it("samples the local background and adds an outline when contrast varies", () => {
    const style = publishingAlbumContrastForPoints(
      [{ x: 20, y: 20 }, { x: 80, y: 20 }],
      x => x < 50 ? { r: 245, g: 245, b: 245 } : { r: 20, g: 20, b: 20 }
    );
    expect(style.outlineColor).not.toBeNull();
    expect(style.outlineWidth).toBeGreaterThan(0);
  });

  it("rejects unknown, unloaded and glyph-incomplete fonts before planning", () => {
    expect(buildPublishingAlbumLayout({
      text: "正文", fontId: "lxgw-wenkai", geometry: wideRegion,
      canvas: { width: 600, height: 800 }, metrics,
    })).toMatchObject({ status: "invalid", reason: "unknown_font" });
    expect(buildPublishingAlbumLayout({
      text: "正文", fontId: "noto-serif-sc", geometry: wideRegion,
      canvas: { width: 600, height: 800 }, metrics: { ...metrics, isLoaded: () => false },
    })).toMatchObject({ status: "invalid", reason: "font_not_loaded" });
    expect(buildPublishingAlbumLayout({
      text: "𠀀", fontId: "zcool-xiaowei", geometry: wideRegion,
      canvas: { width: 600, height: 800 }, metrics: { ...metrics, supportsText: () => false },
    })).toMatchObject({ status: "invalid", reason: "missing_glyphs" });
  });
});
