/**
 * 两份提示词权重表的同步校验。
 *
 * `shared/promptDimensionWeights.ts`（服务端谱系编译用，snake_case 键）和
 * `client/.../promptTable/buildPromptTable.ts`（客户端提示词表用，camelCase 键）
 * 是两张独立维护的表，覆盖同一组创作维度却各自手写数字。
 * 原始审查发现过一次真实的不同步（style_reference 两边都是 0.26，纯属巧合没检测出来），
 * 这个测试就是不让它再发生：任何一边改了权重、另一边没跟着改，CI 就红。
 *
 * 不是所有维度都两边都有——client 表还有 shotType/cameraAngle/videoStart/videoEnd/
 * transitionIn/transitionOut 六个维度，shared 表里没有对应项（见
 * evals/run-weight-analysis.ts 报告里的「（默认值）」标记，这是已知、单独记录的缺口，
 * 不属于本测试要防的「同一维度两个数字」问题）。本测试只比较两边都显式定义的维度。
 */
import { describe, expect, it } from "vitest";

import {
  CONTENT_DIMENSIONS,
  VIDEO_DIMENSIONS,
} from "../client/src/features/creationEditor/promptTable/buildPromptTable";
import { PROMPT_DIMENSION_WEIGHTS } from "../shared/promptDimensionWeights";
import { dimensionForField } from "../shared/promptFieldDimensions";

describe("两份提示词权重表保持同步", () => {
  const clientDimensions = [...CONTENT_DIMENSIONS, ...VIDEO_DIMENSIONS];
  const sharedKeys = new Set(Object.keys(PROMPT_DIMENSION_WEIGHTS));

  const overlapping = clientDimensions
    .map(item => ({
      clientKey: item.dimension,
      sharedKey: dimensionForField(item.dimension),
      clientWeight: item.weight,
    }))
    .filter(item => sharedKeys.has(item.sharedKey));

  it("两边都定义的维度确实存在可比对的样本（防止这个测试本身悄悄失效）", () => {
    expect(overlapping.length).toBeGreaterThanOrEqual(8);
  });

  it.each(overlapping)(
    "$clientKey (client) ↔ $sharedKey (shared) 权重一致",
    ({ sharedKey, clientWeight }) => {
      expect(PROMPT_DIMENSION_WEIGHTS[sharedKey]).toBe(clientWeight);
    },
  );
});
