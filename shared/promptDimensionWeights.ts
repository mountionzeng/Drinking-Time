/**
 * 维度权重查表。
 *
 * 数值不再在这里手写——统一由 `shared/promptDimensions.ts` 的规范词表派生，
 * 那里同时登记了别名（camelCase / 镜头字段名）与「别处硬编码但未生效」的数值。
 *
 * 行为与手写表时期一致：
 *   - 原先 38 个键返回同样的数值（`promptDimensions.test.ts` 逐个钉住）
 *   - 未登记的名字仍然落到 `DEFAULT_PROMPT_WEIGHT`
 * 生产代码里 `promptDimensionWeight()` 的三处调用点（migration / art 库 /
 * lineage store）传入的 dimension 参数一律已是规范 snake_case，因此别名解析
 * 不会改变任何现有调用的返回值——它只是让别名查询不再需要单独维护。
 */
import { PROMPT_DIMENSIONS, promptDimension } from "./promptDimensions";

const DEFAULT_PROMPT_WEIGHT = 0.3;

/** 按规范 id 索引的权重表。别名解析走 {@link promptDimensionWeight}。 */
const PROMPT_DIMENSION_WEIGHTS: Record<string, number> = Object.fromEntries(
  PROMPT_DIMENSIONS.map(def => [def.id, def.weight]),
);

export { DEFAULT_PROMPT_WEIGHT, PROMPT_DIMENSION_WEIGHTS };

export function promptDimensionWeight(dimension: string): number {
  return promptDimension(dimension)?.weight ?? DEFAULT_PROMPT_WEIGHT;
}

export function normalizePromptWeight(
  value: unknown,
  fallback = DEFAULT_PROMPT_WEIGHT,
): number {
  const numeric =
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, numeric));
}
