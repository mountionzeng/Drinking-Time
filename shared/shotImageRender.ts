import { z } from "zod";
import { estimateStoryboardMaskedEditCost } from "./imageRenderCost";

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
  const unitCny = estimateStoryboardMaskedEditCost().estimatedCny;
  return {
    count,
    unitCny,
    estimatedCny: Math.round(unitCny * count * 100) / 100,
  };
}
/** Never retry a failed/uncertain submission. Each completed result remains usable. */
export async function renderShotImageBatch<T>(
  count: number,
  generate: (index: number) => Promise<T>,
  onProgress?: (completed: number) => void
) {
  quoteShotImages(count);
  const results: T[] = [];
  let error: string | undefined;
  for (let index = 0; index < count; index++) {
    try {
      results.push(await generate(index));
      onProgress?.(results.length);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "图片生成失败";
      break;
    }
  }
  return { results, error, remainingCount: count - results.length };
}
