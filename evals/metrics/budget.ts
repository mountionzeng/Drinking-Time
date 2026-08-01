/**
 * 指标四：长度预算。
 *
 * 旧的拼装路径 `buildUnifiedPrompt` 有 3000 字符软上限，超了会逐块丢尾；
 * 谱系编译器 `compilePromptTargets` 没有任何上限——迁移到谱系时这道闸门丢了。
 * 本指标就守这条线：太长（稀释重点、可能被供应商截断）和太短（描述不足）都算不合格。
 */
import { PROMPT_LENGTH_BUDGET } from "../../shared/promptContext";
import type { EvalSample, MetricResult, Violation } from "../types";

/** 低于这个长度的提示词基本是空壳，生成结果完全靠模型脑补 */
export const PROMPT_LENGTH_FLOOR = 80;

function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index];
}

export function budgetMetric(
  samples: readonly EvalSample[],
  maxViolations = 40,
): MetricResult {
  const violations: Violation[] = [];
  const lengths: number[] = [];
  let overBudget = 0;
  let tooShort = 0;
  let withinBudget = 0;

  for (const sample of samples) {
    const length = sample.finalText.length;
    lengths.push(length);

    if (length > PROMPT_LENGTH_BUDGET) {
      overBudget += 1;
      if (violations.length < maxViolations) {
        violations.push({
          rule: "overBudget",
          storyId: sample.storyId,
          stableShotId: sample.stableShotId,
          modality: sample.modality,
          dimension: "(整段)",
          evidence: `${length} 字符，超出预算 ${length - PROMPT_LENGTH_BUDGET}`,
          source: null,
        });
      }
    } else if (length < PROMPT_LENGTH_FLOOR) {
      tooShort += 1;
      if (violations.length < maxViolations) {
        violations.push({
          rule: "tooShort",
          storyId: sample.storyId,
          stableShotId: sample.stableShotId,
          modality: sample.modality,
          dimension: "(整段)",
          evidence: `仅 ${length} 字符：${sample.finalText.replace(/\s+/g, " ").slice(0, 60)}`,
          source: null,
        });
      }
    } else {
      withinBudget += 1;
    }
  }

  const sorted = [...lengths].sort((left, right) => left - right);
  return {
    key: "budget",
    label: `长度预算（${PROMPT_LENGTH_FLOOR}–${PROMPT_LENGTH_BUDGET} 字符内占比）`,
    score: samples.length > 0 ? withinBudget / samples.length : 1,
    passed: withinBudget,
    total: samples.length,
    details: {
      中位数: quantile(sorted, 0.5),
      p90: quantile(sorted, 0.9),
      最长: sorted[sorted.length - 1] ?? 0,
      超预算: overBudget,
      过短: tooShort,
    },
    violations,
  };
}
