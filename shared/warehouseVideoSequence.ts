import { z } from "zod";
import { frameReviewVideoBindingSchema } from "./frameReviewVideo";
import { videoObjectOrigin } from "./videoObjectOrigin";

export const warehouseVideoSequenceInput = z.object({
  storyId: z.number().int().positive(),
  stableShotId: z.string().trim().min(1).max(128),
  imageIds: z
    .array(z.number().int().positive())
    .min(2)
    .max(5)
    .refine((ids) => new Set(ids).size === ids.length, "请选择不同的图片"),
  segmentSeconds: z.number().int().min(1).max(8),
  secondCues: z.array(z.array(z.string().trim().min(1).max(120)).min(1).max(8)).min(1).max(4).optional(),
  objectOrigin: videoObjectOrigin.optional(),
  prompt: z.string().trim().min(1).max(700),
  review: frameReviewVideoBindingSchema.optional(),
});
export type WarehouseVideoSequenceInput = z.infer<
  typeof warehouseVideoSequenceInput
>;
export function warehouseSequencePairs(imageIds: readonly number[]) {
  return imageIds.slice(1).map((id, index) => [imageIds[index], id] as const);
}

export const warehouseCueOpeningInput = warehouseVideoSequenceInput.pick({
  storyId: true, stableShotId: true, prompt: true, objectOrigin: true,
}).extend({
  messageId: z.string().uuid(),
  imageId: z.number().int().positive(),
  referenceIds: z.array(z.number().int().positive()).max(8),
  seconds: z.array(z.string().trim().min(1).max(120)).min(1).max(10),
});
export type WarehouseCueOpeningInput = z.infer<typeof warehouseCueOpeningInput>;
