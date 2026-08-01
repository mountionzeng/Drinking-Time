/**
 * 指标一：提示词卫生。
 *
 * 检查最终提示词里有没有混进「不该给模型看的东西」——文件名、分辨率、URL、
 * 素材管理标签。这些是数据管道漏进来的，不是创作意图，会稀释真正的描述。
 *
 * 逐维度检测（不是整段扫），这样每条违规都能报出 dimension + source，
 * 直接指向该去哪个模块修。
 */
import type { EvalSample, MetricResult, Violation } from "../types";

type HygieneRule = {
  key: string;
  label: string;
  pattern: RegExp;
};

const RULES: HygieneRule[] = [
  {
    key: "assetFilename",
    label: "素材文件名",
    pattern: /[\w\-.]+\.(?:mp4|mov|webm|png|jpe?g|webp|gif)\b/i,
  },
  {
    key: "pixelDimensions",
    label: "像素分辨率",
    pattern: /\b\d{3,4}\s*[x×]\s*\d{3,4}\b/,
  },
  { key: "url", label: "URL", pattern: /https?:\/\/\S+/i },
  {
    key: "materialLabel",
    label: "素材管理字样",
    pattern: /的\s*(?:video|image|视频|图片|音频)\s*素材/,
  },
  {
    key: "uiBucketLabel",
    label: "UI 分桶标签",
    pattern: /(?:^|\n)\s*(?:待筛|候选|已用|未用|video|image|audio|[A-Z])\s*(?=\n|$)/,
  },
];

/** 截出违规证据：命中处前后各留一点上下文，压成单行 */
function evidenceFrom(content: string, match: RegExpMatchArray): string {
  const at = match.index ?? 0;
  const start = Math.max(0, at - 20);
  const slice = content.slice(start, at + match[0].length + 20);
  return `${start > 0 ? "…" : ""}${slice.replace(/\s+/g, " ").trim()}…`;
}

export function hygieneMetric(
  samples: readonly EvalSample[],
  maxViolations = 40,
): MetricResult {
  const violations: Violation[] = [];
  const ruleHits: Record<string, number> = {};
  let cleanSamples = 0;

  for (const sample of samples) {
    let sampleClean = true;
    for (const [dimension, content] of Object.entries(
      sample.contentByDimension,
    )) {
      for (const rule of RULES) {
        const match = content.match(rule.pattern);
        if (!match) continue;
        sampleClean = false;
        ruleHits[rule.key] = (ruleHits[rule.key] ?? 0) + 1;
        if (violations.length < maxViolations) {
          violations.push({
            rule: rule.key,
            storyId: sample.storyId,
            stableShotId: sample.stableShotId,
            modality: sample.modality,
            dimension,
            evidence: evidenceFrom(content, match),
            source: sample.sourceByDimension[dimension] ?? null,
          });
        }
      }
    }
    if (sampleClean) cleanSamples += 1;
  }

  const details: Record<string, number | string> = {};
  for (const rule of RULES) {
    details[`${rule.label}(${rule.key})`] = ruleHits[rule.key] ?? 0;
  }

  return {
    key: "hygiene",
    label: "提示词卫生（无泄漏样本占比）",
    score: samples.length > 0 ? cleanSamples / samples.length : 1,
    passed: cleanSamples,
    total: samples.length,
    details,
    violations,
  };
}

export const HYGIENE_RULES = RULES;
