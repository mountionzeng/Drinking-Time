/**
 * 提示词评测 —— 共享类型。
 *
 * 评测对象是「当前代码编译出来的提示词」，不是历史存档：
 * corpus 只提供 nodes/revisions/bindings 这些**事实**，
 * 由 `compilePromptTargets`（真实编译器）现场编译，指标再打分。
 * 这样改编译器 / 改权重，分数就会动——这才是回归闸门。
 */
import type { PromptModality } from "../shared/promptLineage";

export type EvalModality = Exclude<PromptModality, "shared">;

/** 一条被评测的样本：某故事某镜头某模态编译出的最终提示词 */
export type EvalSample = {
  storyId: number;
  stableShotId: string;
  modality: EvalModality;
  finalText: string;
  /** 参与本次编译的维度（按编译顺序） */
  dimensions: string[];
  /** dimension → 内容，供指标查具体值 */
  contentByDimension: Record<string, string>;
  /** dimension → 该修订的 source（`story.title` / `shot.subject` …），用于定位污染来源 */
  sourceByDimension: Record<string, string | null>;
};

/** 一次违规命中 */
export type Violation = {
  rule: string;
  storyId: number;
  stableShotId: string;
  modality: EvalModality;
  dimension: string;
  /** 触发违规的原文片段，截断后用于报告 */
  evidence: string;
  /** 该内容的来源，指向该去哪儿修 */
  source: string | null;
};

/** 单个指标的结果 */
export type MetricResult = {
  /** 指标标识，如 `hygiene` */
  key: string;
  /** 中文名，报告里显示 */
  label: string;
  /** 主分数，0–1，越高越好 */
  score: number;
  /** 分子/分母，让分数可解释 */
  passed: number;
  total: number;
  /** 附加数字（中位数、p90 之类），报告里原样打印 */
  details: Record<string, number | string>;
  /** 具体违规，最多保留前 N 条 */
  violations: Violation[];
};

export type EvalReport = {
  generatedAt: string;
  corpus: {
    stories: number;
    shots: number;
    samples: number;
  };
  metrics: MetricResult[];
};

/** baseline.json 的形状：只存可比较的数字，不存易变的违规明细 */
export type Baseline = {
  generatedAt: string;
  corpus: EvalReport["corpus"];
  scores: Record<string, { score: number; passed: number; total: number }>;
};
