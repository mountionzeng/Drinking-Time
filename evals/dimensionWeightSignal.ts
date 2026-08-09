/**
 * 维度权重信号 —— 拿真实编辑历史检验 `PROMPT_DIMENSION_WEIGHTS` 里那 40 个手写数字。
 *
 * 逻辑很朴素：一个维度如果总被用户改，说明 agent 在这个维度上的默认产出经常不够好，
 * 值得在提示词里给它更多篇幅/权重去争取一次做对；如果几乎不改，说明当前权重已经够用，
 * 加更多权重是浪费。这不是因果证明（编辑率高也可能只是这个维度天然更主观、
 * 用户本来就想反复调），但作为「手写权重该往哪个方向修」的第一手证据，
 * 比拍脑袋强——尤其是当它和别的独立信号指向同一个维度时（见 misaligned() 的用法）。
 */
import {
  PROMPT_DIMENSION_WEIGHTS,
  promptDimensionWeight,
} from "../shared/promptDimensionWeights";
import type { ShotEditFacts } from "./editSnapshotCorpus";

export type DimensionSignal = {
  dimension: string;
  /** 出现过该字段的镜头数（分母） */
  shotsWithField: number;
  /** 至少被改过一次的镜头数（分子） */
  shotsEdited: number;
  editRate: number;
  currentWeight: number;
  /** 该维度是否在 PROMPT_DIMENSION_WEIGHTS 里显式配置，还是落到了默认值 */
  hasExplicitWeight: boolean;
};

export function computeDimensionSignals(
  shots: ReadonlyMap<string, ShotEditFacts>,
): DimensionSignal[] {
  const shotsWithField = new Map<string, number>();
  const shotsEdited = new Map<string, number>();

  shots.forEach(facts => {
    facts.presentDimensions.forEach(dimension => {
      shotsWithField.set(dimension, (shotsWithField.get(dimension) ?? 0) + 1);
    });
    facts.editedDimensions.forEach(dimension => {
      shotsEdited.set(dimension, (shotsEdited.get(dimension) ?? 0) + 1);
    });
  });

  return Array.from(shotsWithField.entries())
    .map(([dimension, total]) => ({
      dimension,
      shotsWithField: total,
      shotsEdited: shotsEdited.get(dimension) ?? 0,
      editRate: total > 0 ? (shotsEdited.get(dimension) ?? 0) / total : 0,
      currentWeight: promptDimensionWeight(dimension),
      hasExplicitWeight: dimension in PROMPT_DIMENSION_WEIGHTS,
    }))
    .sort((left, right) => right.editRate - left.editRate);
}

export type MisalignedDimension = DimensionSignal & {
  /** 'underweighted' = 常改却权重低；'overweighted' = 权重高却几乎不改 */
  direction: "underweighted" | "overweighted";
};

/**
 * 找出「编辑率排名」和「权重排名」明显对不上的维度。
 * 用排名差而不是绝对值差——编辑率和权重量纲不同，排名差更稳健，
 * 也天然不受样本量小的维度（分母 <5）的极端比率干扰太多。
 */
export function findMisalignedDimensions(
  signals: readonly DimensionSignal[],
  options: { minShots?: number; minRankGap?: number } = {},
): MisalignedDimension[] {
  const minShots = options.minShots ?? 8;
  const minRankGap = options.minRankGap ?? 3;

  const eligible = signals.filter(s => s.shotsWithField >= minShots);
  const byEditRateRank = [...eligible].sort(
    (a, b) => b.editRate - a.editRate,
  );
  const byWeightRank = [...eligible].sort(
    (a, b) => b.currentWeight - a.currentWeight,
  );
  const editRateRank = new Map(
    byEditRateRank.map((s, index) => [s.dimension, index]),
  );
  const weightRank = new Map(
    byWeightRank.map((s, index) => [s.dimension, index]),
  );

  const withGap = eligible.map(signal => ({
    signal,
    // 正值：编辑率排名靠前（改得多）但权重排名靠后（权重低）→ 该加权
    gap: weightRank.get(signal.dimension)! - editRateRank.get(signal.dimension)!,
  }));

  return withGap
    .filter(({ gap }) => Math.abs(gap) >= minRankGap)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .map(({ signal, gap }) => ({
      ...signal,
      direction: gap > 0 ? "underweighted" : ("overweighted" as const),
    }));
}
