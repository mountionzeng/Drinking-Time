import { z } from "zod";

export const frameReviewVideoBindingSchema = z.object({
  reviewId: z.string().uuid(),
  reviewRevision: z.number().int().nonnegative(),
  timelineVersion: z.number().int().nonnegative(),
});
export type FrameReviewVideoBinding = z.infer<typeof frameReviewVideoBindingSchema>;
export type FrameReviewVideoPlan = {
  storyId: number;
  stableShotId: string;
  shotNo: number;
  review: FrameReviewVideoBinding;
  sourceTakeId: number;
  sourceDurationSec: number;
  segmentSeconds: number;
  images: Array<{ id: number; imageUrl: string; label: string }>;
  prompt: string;
};

/** Asking to inspect a video plan is never payment or image approval. */
export function isFrameReviewVideoRequest(text: string): boolean {
  return /(?:生成|渲染|制作|报价|检查).*视频|视频.*(?:报价|生成)|\b(?:render|generate|create|quote|check).*video/i.test(text)
    && !/(?:不|别|无需|不必|不要|暂不|先不)[^，。；;\n]{0,10}(?:生成|渲染|制作).*视频|\b(?:don't|do not|not yet)\s+(?:generate|render|create)/i.test(text);
}
