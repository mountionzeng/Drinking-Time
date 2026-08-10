import { describe, expect, it } from "vitest";

import { budgetMetric } from "./budget";
import { continuityMetric } from "./continuity";
import { coverageMetric, EXPECTED_DIMENSIONS } from "./coverage";
import { hygieneMetric } from "./hygiene";
import type { EvalModality, EvalSample } from "../types";

function sample(
  overrides: Partial<EvalSample> & { contentByDimension: Record<string, string> },
): EvalSample {
  const contentByDimension = overrides.contentByDimension;
  return {
    storyId: overrides.storyId ?? 1,
    stableShotId: overrides.stableShotId ?? "shot-1",
    modality: overrides.modality ?? ("image" as EvalModality),
    finalText:
      overrides.finalText ??
      Object.entries(contentByDimension)
        .map(([dimension, content]) => `${dimension}: ${content}`)
        .join("\n"),
    dimensions: overrides.dimensions ?? Object.keys(contentByDimension),
    contentByDimension,
    sourceByDimension: overrides.sourceByDimension ?? {},
  };
}

describe("hygieneMetric", () => {
  it("放行干净的提示词", () => {
    const result = hygieneMetric([
      sample({ contentByDimension: { subject: "冬夜的菜市场", mood: "安静" } }),
    ]);
    expect(result.score).toBe(1);
    expect(result.violations).toHaveLength(0);
  });

  it("抓出文件名、分辨率、URL 和素材字样", () => {
    const result = hygieneMetric([
      sample({ contentByDimension: { subject: "第三幕 的 video 素材 2.mp4" } }),
      sample({ contentByDimension: { composition: "1920x1088\n720x1280" } }),
      sample({ contentByDimension: { style_reference: "见 https://x.com/a" } }),
    ]);
    expect(result.score).toBe(0);
    const rules = new Set(result.violations.map(violation => violation.rule));
    expect(rules).toContain("assetFilename");
    expect(rules).toContain("materialLabel");
    expect(rules).toContain("pixelDimensions");
    expect(rules).toContain("url");
  });

  it("违规里带上 source，指明该去哪儿修", () => {
    const result = hygieneMetric([
      sample({
        contentByDimension: { composition: "1920x1088" },
        sourceByDimension: { composition: "story.visualCanvasItems" },
      }),
    ]);
    expect(result.violations[0].source).toBe("story.visualCanvasItems");
    expect(result.violations[0].dimension).toBe("composition");
  });

  it("抓出只出现在最终编译文本里的污染，并标记为整段来源", () => {
    const result = hygieneMetric([
      sample({
        contentByDimension: { subject: "冬夜的菜市场" },
        finalText: "subject(42%): 冬夜的菜市场\nUI 素材 1920x1080",
      }),
    ]);

    expect(result.score).toBe(0);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "pixelDimensions",
          dimension: "(整段)",
          source: null,
        }),
      ]),
    );
  });

  it("编译器加上维度前缀后仍能抓出整行 UI 标签", () => {
    const result = hygieneMetric([
      sample({
        contentByDimension: { style_reference: "A" },
        sourceByDimension: { style_reference: "shot.styleRef" },
      }),
    ]);

    expect(result.score).toBe(0);
    expect(result.violations[0]).toMatchObject({
      rule: "uiBucketLabel",
      dimension: "style_reference",
      source: "shot.styleRef",
    });
  });

  it("不把正常中文描述误判成 UI 标签", () => {
    const result = hygieneMetric([
      sample({ contentByDimension: { mood: "克制\n疏离\n带一点暖" } }),
    ]);
    expect(result.score).toBe(1);
  });
});

describe("coverageMetric", () => {
  it("填满期望维度得满分", () => {
    const filled = Object.fromEntries(
      EXPECTED_DIMENSIONS.image.map(dimension => [dimension, "有内容"]),
    );
    const result = coverageMetric([
      sample({ modality: "image", contentByDimension: filled }),
    ]);
    expect(result.score).toBe(1);
  });

  it("空白字符串不算填充", () => {
    const result = coverageMetric([
      sample({
        modality: "dialogue",
        contentByDimension: { subject: "人", action: "   ", intent: "" },
      }),
    ]);
    // dialogue 期望 6 个维度，只有 subject 真的填了
    expect(result.passed).toBe(1);
    expect(result.total).toBe(EXPECTED_DIMENSIONS.dialogue.length);
  });
});

describe("continuityMetric", () => {
  it("全片共用一个风格锚点时满分", () => {
    const shots = ["a", "b", "c"].map(id =>
      sample({
        stableShotId: id,
        modality: "image",
        contentByDimension: { style_reference: "黑红版画" },
      }),
    );
    expect(continuityMetric(shots).score).toBe(1);
  });

  it("缺锚点和偏离主基调都算风险", () => {
    const result = continuityMetric([
      sample({ stableShotId: "a", contentByDimension: { style_reference: "黑红版画" } }),
      sample({ stableShotId: "b", contentByDimension: { style_reference: "黑红版画" } }),
      sample({ stableShotId: "c", contentByDimension: { style_reference: "水彩" } }),
      sample({ stableShotId: "d", contentByDimension: { subject: "只有主体" } }),
    ]);
    expect(result.passed).toBe(2);
    expect(result.details["无风格锚点"]).toBe(1);
    expect(result.details["与主基调不一致"]).toBe(1);
  });

  it("只看图片模态", () => {
    const result = continuityMetric([
      sample({ modality: "dialogue", contentByDimension: { subject: "人" } }),
    ]);
    expect(result.total).toBe(0);
  });
});

describe("budgetMetric", () => {
  it("区分过短、正常和超预算", () => {
    const result = budgetMetric([
      sample({ finalText: "太短", contentByDimension: {} }),
      sample({ finalText: "正".repeat(500), contentByDimension: {} }),
      sample({ finalText: "长".repeat(4000), contentByDimension: {} }),
    ]);
    expect(result.passed).toBe(1);
    expect(result.details["过短"]).toBe(1);
    expect(result.details["超预算"]).toBe(1);
  });
});
