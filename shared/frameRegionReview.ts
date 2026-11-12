import { z } from "zod";
import { chatFrameReferenceSchema, explicitReferenceShotNumber, isFrameReferenceChat } from "./chatFrameReference";

export const regionTargetSchema = z.enum(["forest", "plane", "cloud", "city"]);
export type RegionTarget = z.infer<typeof regionTargetSchema>;
export const regionAreaSchema = z.enum(["all", "left", "right", "top", "bottom"]);
const imageUrl = z.string().regex(/^(?:\/api\/images\/|https?:\/\/)/);
export const frameRegionTaskSchema = z.object({
  target: regionTargetSchema, imageId: z.number().int().positive(), instruction: z.string(),
  threshold: z.number().min(.15).max(.7), area: regionAreaSchema,
  sourceSha: z.string(), maskSha: z.string(), maskUrl: imageUrl, protectedUrl: imageUrl,
  objectMaskUrl: imageUrl.optional(), objectMaskSha: z.string().optional(),
  approvedRevision: z.number().int().nonnegative().optional(),
  overlayUrl: imageUrl, selectedPixels: z.number().int().nonnegative(),
  candidate: z.object({ imageId: z.number().int().positive(), imageUrl, changedPixels: z.number(), outsideChangedPixels: z.literal(0) }).optional(),
});
export const frameRegionSourceSchema = chatFrameReferenceSchema.pick({ storyId: true, stableShotId: true, shotNo: true, imageId: true, imageUrl: true });
export type FrameRegionSource = z.infer<typeof frameRegionSourceSchema>;
export const frameRegionReviewSchema = z.object({
  id: z.string().uuid(), revision: z.number().int().nonnegative(), storyId: z.number().int().positive(),
  stableShotId: z.string(), shotNo: z.number(), timelineVersion: z.number(),
  phase: z.enum(["frames_ready", "scope_review", "scope_confirmed", "image_review", "images_confirmed", "cancelled"]),
  frames: z.array(chatFrameReferenceSchema).min(1).max(6), sourceImages: z.array(frameRegionSourceSchema).max(4).optional(), tasks: z.array(frameRegionTaskSchema).max(4),
  instructions: z.array(z.string()).max(100), activeTarget: regionTargetSchema.optional(),
  approvedRevision: z.number().optional(), createdAt: z.number(), updatedAt: z.number(), editorUserId: z.number(),
});
export type FrameRegionReview = z.infer<typeof frameRegionReviewSchema>;
export type FrameRegionTask = z.infer<typeof frameRegionTaskSchema>;
export const regionLabels: Record<RegionTarget, { zh: string; en: string }> = {
  forest: { zh: "森林", en: "Forest" }, plane: { zh: "飞机", en: "Airplane" },
  cloud: { zh: "云层", en: "Clouds" }, city: { zh: "城市", en: "City" },
};
const words: Record<RegionTarget, RegExp> = {
  forest: /森林|树木|树冠|树叶|树|\b(?:forest|trees?|foliage)\b/i,
  plane: /纸飞机|飞机|\b(?:paper airplane|airplane|plane)\b/i,
  cloud: /云层|云朵|云海|云|\bclouds?\b/i,
  city: /城市|建筑|\b(?:city|buildings?)\b/i,
};

/** Routing vocabulary only. Actual pixels come from the vision model and require review. */
export function regionTargets(text: string): RegionTarget[] {
  const clauses = text.split(/[，。；;\n]/);
  return (Object.keys(words) as RegionTarget[]).filter(target => clauses.some(clause =>
    words[target].test(clause) && !/(?:不改|不要动|别动|不动|不变|保持原样|保持不变|保留原|unchanged|leave.*alone|don't change|do not change)/i.test(clause)));
}
export function regionReviewDecision(text: string) {
  const value = text.trim().replace(/[。！!]+$/, "");
  if (/^(?:确认(?:森林|树冠|飞机|纸飞机|云层|云朵|城市|建筑)?范围|范围确认|范围没问题|就这个范围|confirm (?:the )?(?:(?:forest|trees|airplane|plane|clouds|city) )?(?:regions?|scope))$/i.test(value)) return "confirm_scope";
  if (/^(?:确认图片|图片可以|确认这些图片|confirm (?:the )?images?)$/i.test(value)) return "confirm_images";
  if (/^(?:取消范围修改|取消这次修改|取消|cancel(?: edit)?)$/i.test(value)) return "cancel";
  return null;
}
export function isRegionRefinement(text: string) {
  return /范围|扩大|缩小|多选|少选|只选|左边|右边|上半|下半|\b(?:region|scope|smaller|larger|left|right|top|bottom)\b/i.test(text);
}
export function isFrameRegionChat(text: string, review?: FrameRegionReview | null) {
  if (isFrameReferenceChat(text)) return true;
  if (!review || review.phase === "cancelled") return false;
  if (regionReviewDecision(text)) return true;
  if (/生成.*视频|渲染.*视频|\b(?:render|generate).*video/i.test(text)) return true;
  return isRegionRefinement(text) || (regionTargets(text).length > 0 && /改|变|希望|定位|选|识别|大一点|厚一点|一个|\b(?:edit|change|make|locate|select|one|bigger|thicker)\b/i.test(text));
}
export function latestFrameRegionReview(messages: Array<{ frameReview?: FrameRegionReview }>, storyId: number, text: string, stableShotId?: string | null) {
  const shotNo = explicitReferenceShotNumber(text);
  return messages.slice().reverse().map(message => message.frameReview).find(review => review?.storyId === storyId &&
    (shotNo != null ? review.shotNo === shotNo : !stableShotId || review.stableShotId === stableShotId));
}
export function reviseRegionScope(task: Pick<FrameRegionTask, "threshold" | "area">, text: string) {
  let threshold = task.threshold, area = task.area;
  if (/缩小|少选|smaller/i.test(text)) threshold = Math.min(.7, threshold + .06);
  if (/扩大|多选|larger/i.test(text)) threshold = Math.max(.15, threshold - .06);
  for (const [pattern, value] of [[/左边|\bleft\b/i, "left"], [/右边|\bright\b/i, "right"], [/上半|\btop\b/i, "top"], [/下半|前景|\bbottom\b/i, "bottom"], [/全部|整片|\ball\b/i, "all"]] as const)
    if (pattern.test(text)) area = value;
  return { threshold, area };
}

/** Keep per-object requests distinct; a cloud size request must not become a tree size edit. */
export function regionInstruction(text: string, target: RegionTarget) {
  const clauses = text.split(/[；;。\n]/).filter(clause => words[target].test(clause));
  return clauses.length ? clauses.join("；") : text;
}
export function regionTemporalFrames(text: string, frames: { imageId: number }[]) {
  if (/第一帧|首帧|开头|面板.*飞出|first frame|opening|emerg/i.test(text)) return frames.slice(0, 2).map(frame => frame.imageId);
  if (/最后|结尾|末尾|尾帧|last|ending|final/i.test(text)) return frames.slice(-2).map(frame => frame.imageId);
  return frames.map(frame => frame.imageId);
}
