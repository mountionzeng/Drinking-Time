/**
 * 指标三：跨镜头视觉连续性。
 *
 * AI 视频最容易垮的地方：每个镜头单独看都不错，连起来像三部不同的片子。
 * 这里只看图片模态——一个镜头要么**没有风格锚点**（模型自由发挥，重渲必漂），
 * 要么**风格锚点跟全片主基调不一致**（接起来跳戏）。两者都算连续性风险。
 *
 * 主基调取该故事出现最多的风格值（众数），而不是第一个镜头的值——
 * 避免开场镜头写错就把整条基线带偏。
 */
import type { EvalSample, MetricResult, Violation } from "../types";

/** 能充当风格锚点的维度，按优先级排列 */
const STYLE_DIMENSIONS = ["style_reference", "visual_style", "art_style_recipe"];

function styleAnchorOf(sample: EvalSample): string | null {
  for (const dimension of STYLE_DIMENSIONS) {
    const value = sample.contentByDimension[dimension];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** 众数；并列时取字典序最小，保证结果稳定可复现 */
function modeOf(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of Array.from(counts.entries()).sort((l, r) =>
    l[0].localeCompare(r[0]),
  )) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

export function continuityMetric(
  samples: readonly EvalSample[],
  maxViolations = 40,
): MetricResult {
  const imageSamples = samples.filter(sample => sample.modality === "image");

  const byStory = new Map<number, EvalSample[]>();
  for (const sample of imageSamples) {
    byStory.set(sample.storyId, [...(byStory.get(sample.storyId) ?? []), sample]);
  }

  const violations: Violation[] = [];
  let consistent = 0;
  let unanchored = 0;
  let divergent = 0;

  for (const [, shots] of Array.from(byStory.entries()).sort(
    (left, right) => left[0] - right[0],
  )) {
    const anchors = shots
      .map(shot => styleAnchorOf(shot))
      .filter((value): value is string => value !== null);
    const dominant = modeOf(anchors);

    for (const shot of shots) {
      const anchor = styleAnchorOf(shot);
      if (anchor === null) {
        unanchored += 1;
        if (violations.length < maxViolations) {
          violations.push({
            rule: "unanchored",
            storyId: shot.storyId,
            stableShotId: shot.stableShotId,
            modality: shot.modality,
            dimension: STYLE_DIMENSIONS[0],
            evidence: "该镜头没有任何风格锚点维度",
            source: null,
          });
        }
        continue;
      }
      if (dominant !== null && anchor !== dominant) {
        divergent += 1;
        if (violations.length < maxViolations) {
          violations.push({
            rule: "divergent",
            storyId: shot.storyId,
            stableShotId: shot.stableShotId,
            modality: shot.modality,
            dimension: STYLE_DIMENSIONS[0],
            evidence: `风格与全片主基调不一致：${anchor.replace(/\s+/g, " ").slice(0, 60)}…`,
            source: shot.sourceByDimension[STYLE_DIMENSIONS[0]] ?? null,
          });
        }
        continue;
      }
      consistent += 1;
    }
  }

  // 每个故事有几种不同的风格写法：1 = 全片共用一个锚点；等于镜头数 = 每镜各写各的
  const distinctPerStory: string[] = [];
  for (const [storyId, shots] of Array.from(byStory.entries()).sort(
    (left, right) => left[0] - right[0],
  )) {
    const distinct = new Set(
      shots
        .map(shot => styleAnchorOf(shot))
        .filter((value): value is string => value !== null),
    ).size;
    distinctPerStory.push(`story${storyId}:${distinct}/${shots.length}`);
  }

  return {
    key: "continuity",
    label: "视觉连续性（共享同一风格锚点的镜头占比，逐字比对）",
    score: imageSamples.length > 0 ? consistent / imageSamples.length : 1,
    passed: consistent,
    total: imageSamples.length,
    details: {
      无风格锚点: unanchored,
      与主基调不一致: divergent,
      参评故事数: byStory.size,
      "风格种类/镜头数": distinctPerStory.join("  "),
    },
    violations,
  };
}
