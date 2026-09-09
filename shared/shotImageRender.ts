import { z } from "zod";
import { estimateStoryboardImageCost } from "./imageRenderCost";

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
