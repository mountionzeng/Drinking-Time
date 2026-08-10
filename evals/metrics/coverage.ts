/**
 * 指标二：维度覆盖率。
 *
 * 一个镜头要生成得稳，得先被描述完整。这里定义每个模态「该有哪些维度」，
 * 统计实际编译进去了多少。缺维度不会报错——模型会自己脑补，
 * 脑补的部分就是每次重渲都不一样的部分。
 *
 * 期望集按模态划分，跟 `compilePromptTargets` 的路由一致
 * （台词模态会被过滤掉纯视觉维度，所以不要求 style_reference 之类）。
 */
import type { EvalModality, EvalSample, MetricResult } from "../types";

export const EXPECTED_DIMENSIONS: Record<EvalModality, string[]> = {
  dialogue: ["subject", "action", "intent", "beat", "mood", "dialogue"],
  image: [
    "subject",
    "action",
    "location",
    "time_light",
    "mood",
    "style_reference",
    "image_prompt",
    "negative_prompt",
  ],
  video: [
    "subject",
    "action",
    "mood",
    "time_light",
    "camera_motion",
    "video_prompt",
    "sound",
  ],
};

function isFilled(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function coverageMetric(samples: readonly EvalSample[]): MetricResult {
  let filledTotal = 0;
  let expectedTotal = 0;
  // dimension → [实际填充数, 应填充数]，用来找最弱的维度
  const perDimension = new Map<string, { filled: number; expected: number }>();

  for (const sample of samples) {
    const expected = EXPECTED_DIMENSIONS[sample.modality];
    for (const dimension of expected) {
      const filled = isFilled(sample.contentByDimension[dimension]);
      expectedTotal += 1;
      if (filled) filledTotal += 1;

      const stat = perDimension.get(dimension) ?? { filled: 0, expected: 0 };
      stat.expected += 1;
      if (filled) stat.filled += 1;
      perDimension.set(dimension, stat);
    }
  }

  // 详情按填充率升序——最缺的排最前，一眼看到该补哪儿
  const details: Record<string, number | string> = {};
  for (const [dimension, stat] of Array.from(perDimension.entries()).sort(
    (left, right) =>
      left[1].filled / left[1].expected - right[1].filled / right[1].expected,
  )) {
    const rate = ((stat.filled / stat.expected) * 100).toFixed(0);
    details[dimension] = `${rate}% (${stat.filled}/${stat.expected})`;
  }

  return {
    key: "coverage",
    label: "维度覆盖率（期望维度的填充比例）",
    score: expectedTotal > 0 ? filledTotal / expectedTotal : 1,
    passed: filledTotal,
    total: expectedTotal,
    details,
    violations: [],
  };
}
