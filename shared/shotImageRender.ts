import { z } from "zod";
import { estimateStoryboardImageCost } from "./imageRenderCost";

/** Only explicit user wording can opt a supplied reference into faithful reuse. */
export function requestsStrictReferenceFidelity(instruction: string): boolean {
  return instruction.split(/[。！？\n;]/u).some(clause => {
    if (/(?:不要|不用|不必|无需|不需要).{0,12}(?:一模一样|完全一致|严格保留|完全保留)|(?:not|don't|do not).{0,30}(?:exactly|identical)/i.test(clause)) return false;
    return /一模一样|完全一致|(?:严格|完全)保留(?:原图|参考图)|(?:保留|保持).{0,35}(?:形状|位置|构图|画风|风格).{0,20}不变|(?:keep|preserve).{0,35}(?:exactly the same|identical)/i.test(clause);
  });
}
export const STRICT_REFERENCE_MJ_NOTICE = "已按原图优先处理要求。MJ仍会重绘，不能保证形状、位置和文字完全一致；若必须完全一致，请取消生成，直接把原图设为首帧或尾帧。";

const versionRef = z
  .object({
    assetId: z.string().min(1).max(160),
    versionId: z.string().min(1).max(160),
  })
  .strict();
/** A complete selection. An empty selection explicitly disables all inherited references. */
export const shotRenderReferencesSchema = z
  .object({
    imageIds: z.array(z.number().int().positive()).max(4),
    assets: z
      .object({
        character: versionRef.optional(),
        pet: versionRef.optional(),
        scene: versionRef.optional(),
        style: versionRef.optional(),
      })
      .strict(),
  })
  .strict()
  .refine(
    value => value.imageIds.length + Object.keys(value.assets).length <= 4,
    "最多选择 4 个参考素材"
  );
export type ShotRenderReferences = z.infer<typeof shotRenderReferencesSchema>;
export const shotImageRenderSettingsSchema = z
  .object({
    count: z.number().int().min(1).max(8),
    references: shotRenderReferencesSchema,
  })
  .strict();
export type ShotImageRenderSettings = z.infer<
  typeof shotImageRenderSettingsSchema
>;
export function quoteShotImages(count: number) {
  shotImageRenderSettingsSchema.shape.count.parse(count);
  const estimate = estimateStoryboardImageCost();
  const taskCount = Math.ceil(count / estimate.candidateCount);
  return {
    count,
    taskCount,
    candidatesPerTask: estimate.candidateCount,
    candidateCount: taskCount * estimate.candidateCount,
    taskCny: estimate.estimatedCny,
    estimatedCny: Math.round(estimate.estimatedCny * taskCount * 100) / 100,
  };
}
/** One MJ task yields four candidates. Preserve every paid result; never retry a short or uncertain response. */
export async function renderShotImageBatch<
  T extends { generatedCount: number },
>(count: number, generate: (index: number) => Promise<T>) {
  const quote = quoteShotImages(count);
  const results: T[] = [];
  let error: string | undefined;
  let generatedCount = 0;
  for (let index = 0; index < quote.taskCount; index++) {
    try {
      const result = await generate(index);
      if (!Number.isInteger(result.generatedCount) || result.generatedCount < 1)
        throw new Error("MJ没有返回可用候选，未追加付费任务");
      results.push(result);
      generatedCount += result.generatedCount;
      if (result.generatedCount !== quote.candidatesPerTask)
        throw new Error(
          `MJ本次实际返回${result.generatedCount}张候选，未追加付费任务`
        );
    } catch (cause) {
      if (cause instanceof PendingShotImageError) throw cause;
      error = cause instanceof Error ? cause.message : "图片生成失败";
      break;
    }
  }
  return {
    results,
    generatedCount,
    error,
    remainingCount: Math.max(0, quote.candidateCount - generatedCount),
  };
}

/** An accepted task is recoverable; it is not a failed purchase. */
export class PendingShotImageError extends Error {
  constructor(message: string, public readonly requestId: string) { super(message); this.name = "PendingShotImageError"; }
}
