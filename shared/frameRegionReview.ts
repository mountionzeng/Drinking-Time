import { z } from "zod";
import { chatFrameReferenceSchema, explicitReferenceShotNumber, isFrameReferenceChat } from "./chatFrameReference";
import { isFrameReviewVideoRequest } from "./frameReviewVideo";
import { isImageObjectRemoval } from "./imageObjectRemoval";

export const regionTargetSchema = z.enum(["forest", "plane", "cloud", "city"]);
export type RegionTarget = z.infer<typeof regionTargetSchema>;
export const regionAreaSchema = z.enum(["all", "left", "right", "top", "bottom"]);
const imageUrl = z.string().regex(/^(?:\/api\/images\/|https?:\/\/)/);
export const cloudArtDirectionSchema = z.object({
  quantity: z.enum(["preserve", "slightly_more", "fewer"]),
  textureRepetition: z.enum(["preserve", "reduce"]),
  highlights: z.enum(["preserve", "white"]).optional(),
  shadows: z.enum(["preserve", "colorful"]).optional(),
});
export type CloudArtDirection = z.infer<typeof cloudArtDirectionSchema>;
export const cloudShapeQuoteSchema = z.object({
  requestId: z.string().uuid(), sourceImageId: z.number().int().positive(), sourceImageUrl: imageUrl,
  sourceSha: z.string(), maskUrl: imageUrl, maskSha: z.string(), overlayUrl: imageUrl,
  prompt: z.string().min(1).max(2000), estimatedCny: z.number().nonnegative(), fingerprint: z.string(),
  expiresAt: z.number(), width: z.number(), height: z.number(), growthPixels: z.number(),
  artDirection: cloudArtDirectionSchema.optional(),
});
export type CloudShapeQuote = z.infer<typeof cloudShapeQuoteSchema>;
// A frozen color source, not a pointer to whichever candidate is current later.
export const regionInheritanceSchema = z.object({
  status: z.enum(["pending", "accepted", "declined"]),
  sourceReviewId: z.string().uuid(), sourceRevision: z.number().int().nonnegative(),
  imageId: z.number().int().positive(), imageUrl, imageSha: z.string(),
  maskUrl: imageUrl, maskSha: z.string(), protectedUrl: imageUrl, protectedSha: z.string(),
  objectMaskUrl: imageUrl.optional(), objectMaskSha: z.string().optional(),
  instruction: z.string(), decidedAt: z.number().optional(),
  createdTask: z.boolean().optional(),
  forestTone: z.enum(["reduce_green_flatness", "harmonize_green", "harmonize_green_less_blue"]).optional(),
});
export const frameRegionTaskSchema = z.object({
  target: regionTargetSchema, imageId: z.number().int().positive(), instruction: z.string(),
  threshold: z.number().min(.15).max(.7), area: regionAreaSchema,
  sourceSha: z.string(), maskSha: z.string(), maskUrl: imageUrl, protectedUrl: imageUrl,
  objectMaskUrl: imageUrl.optional(), objectMaskSha: z.string().optional(),
  approvedRevision: z.number().int().nonnegative().optional(),
  inheritance: regionInheritanceSchema.optional(),
  overlayUrl: imageUrl, selectedPixels: z.number().int().nonnegative(),
  shapeQuote: cloudShapeQuoteSchema.optional(),
  cloudArtDirection: cloudArtDirectionSchema.optional(),
  forestTone: z.enum(["reduce_green_flatness", "harmonize_green", "harmonize_green_less_blue"]).optional(),
  candidate: z.object({ imageId: z.number().int().positive(), imageUrl, sourceImageId: z.number().int().positive().optional(), changedPixels: z.number(), outsideChangedPixels: z.literal(0) }).optional(),
});
export const frameRegionSourceSchema = chatFrameReferenceSchema.pick({ storyId: true, stableShotId: true, shotNo: true, imageId: true, imageUrl: true });
export type FrameRegionSource = z.infer<typeof frameRegionSourceSchema>;
export const frameRegionReviewSchema = z.object({
  id: z.string().uuid(), revision: z.number().int().nonnegative(), storyId: z.number().int().positive(),
  stableShotId: z.string(), shotNo: z.number(), timelineVersion: z.number(),
  phase: z.enum(["frames_ready", "scope_review", "scope_confirmed", "image_review", "images_confirmed", "cancelled"]),
  frames: z.array(chatFrameReferenceSchema).min(1).max(6), sourceImages: z.array(frameRegionSourceSchema).max(4).optional(), tasks: z.array(frameRegionTaskSchema).max(4),
  instructions: z.array(z.string()).max(100), activeTarget: regionTargetSchema.optional(),
  declinedInheritanceImageIds: z.array(z.number().int().positive()).max(20).optional(),
  forestTreatmentHistory: z.array(regionInheritanceSchema.omit({ status: true, createdTask: true, decidedAt: true })).max(40).optional(),
  fixedForestPalette: regionInheritanceSchema.omit({ status: true, createdTask: true, decidedAt: true }).nullable().optional(),
  forestPaletteFeedback: z.array(z.object({
    imageId: z.number().int().positive(), decision: z.enum(["accepted", "rejected"]),
    at: z.number(), instruction: z.string(),
  })).max(100).optional(),
  forestPaletteApplications: z.array(z.object({ imageId: z.number().int().positive(), referenceImageId: z.number().int().positive() })).max(100).optional(),
  approvedRevision: z.number().optional(), createdAt: z.number(), updatedAt: z.number(), editorUserId: z.number(),
});
export type FrameRegionReview = z.infer<typeof frameRegionReviewSchema>;
export type FrameReviewTurnOptions = { inspectOnly?: boolean; review?: FrameRegionReview };
export type FrameRegionTask = z.infer<typeof frameRegionTaskSchema>;
export type RegionInheritance = z.infer<typeof regionInheritanceSchema>;
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
    words[target].test(clause) && !/^\s*(?:保护|保留|protect\b|preserve\b)/i.test(clause) && !/(?:不改|不要动|别动|不动|不变|保持原样|保持不变|保留原|unchanged|leave.*alone|don't change|do not change)/i.test(clause)));
}
export function regionReviewDecision(text: string) {
  const value = text.trim().replace(/[。！!]+$/, "");
  if (/^(?:确认(?:森林|树冠|飞机|纸飞机|云层|云朵|城市|建筑)?范围|范围确认|范围没问题|就这个范围|confirm (?:the )?(?:(?:forest|trees|airplane|plane|clouds|city) )?(?:regions?|scope))$/i.test(value)) return "confirm_scope";
  if (/^(?:确认图片|图片可以|确认这些图片|confirm (?:the )?images?)$/i.test(value)) return "confirm_images";
  if (/^(?:取消范围修改|取消这次修改|取消|cancel(?: edit)?)$/i.test(value)) return "cancel";
  return null;
}
export function regionInheritanceDecision(text: string) {
  const value = text.trim().replace(/[。！!]+$/, "");
  if (/^(?:不继承|不沿用(?:上一帧)?|不要沿用(?:上一帧)?|只改云(?:层)?|do not inherit|don't inherit|skip inheritance|only edit (?:the )?clouds)$/i.test(value)) return "decline";
  if (/^(?:沿用上一帧(?:的(?:绿色|改色|修改|处理|森林处理))?|继承上一帧(?:的(?:修改|处理|森林处理))?|确认继承|确认沿用|inherit(?: previous frame)?|use (?:the )?previous (?:frame|green|forest treatment))$/i.test(value)) return "accept";
  return null;
}
export function isRegionRefinement(text: string) {
  return /范围|扩大|缩小|多选|少选|只选|左边|右边|上半|下半|\b(?:region|scope|smaller|larger|left|right|top|bottom)\b/i.test(text);
}
export function isFrameRegionChat(text: string, review?: FrameRegionReview | null) {
  if (isFrameReferenceChat(text)) return true;
  if (!review) return false;
  if (isImageObjectRemoval(text)) return true;
  if (review.phase === "cancelled") return regionTargets(text).length > 0 && isRegionRefinement(text)
    && !regionReviewDecision(text) && !regionInheritanceDecision(text);
  if (regionReviewDecision(text) || regionInheritanceDecision(text)) return true;
  if (forestPaletteFeedbackDecision(text)) return true;
  if (forestPaletteConsistencyDecision(text)) return true;
  if (review.tasks.some(task => task.shapeQuote) && cloudShapeDecision(text)) return true;
  if (review.activeTarget === "cloud" && isCloudAppearanceEdit(text)) return true;
  if (regionTargets(text).includes("forest") && (isForestToneEdit(text) || isForestGreenMatchEdit(text))) return true;
  if (isFrameReviewVideoRequest(text)) return true;
  return isRegionRefinement(text) || (regionTargets(text).length > 0 && /改|变|希望|定位|选|识别|大一点|厚一点|一个|\b(?:edit|change|make|locate|select|one|bigger|thicker)\b/i.test(text));
}

/** Scope approval and a request for consistency are not approval of a color result. */
export function forestPaletteFeedbackDecision(text: string): "accepted" | "rejected" | null {
  let active: RegionTarget[] = [];
  let accepted = false;
  for (const clause of text.split(/[，,。；;\n]/)) {
    if (/吗|是否|[?？]/.test(clause)) continue;
    const targets = regionTargets(clause);
    if (targets.length) active = targets;
    if (active.length && !active.includes("forest")) continue;
    if (/不满意|不认可|不好看|更丑|太丑|难看|不要(?:再)?用.*(?:配色|绿色)|unsatisfied|unhappy|ugly|reject.*(?:forest|palette|colou?r)/i.test(clause)) return "rejected";
    if (!/不需要|不用|无需|不再/.test(clause) && /(?:配色|颜色).*(?:还要|需要|继续).*(?:调整|修改)|(?:还要|需要|继续).*(?:调整|修改).*(?:配色|颜色)/.test(clause)) return "rejected";
    // Approval must explicitly name the forest's appearance, never just “OK”.
    if (/不|没|not |don't /i.test(clause)) continue;
    if (/确认森林配色|认可森林配色|(?:森林|树木|树冠).*(?:配色|颜色|绿色).*(?:满意|认可|可以|好看)|approve (?:the )?forest (?:palette|colou?rs?)/i.test(clause)) accepted = true;
  }
  return accepted ? "accepted" : null;
}

export function forestPaletteStatus(imageId: number, reviews: FrameRegionReview[], images: Array<{ id: number; parentImageId?: number | null }> = []): "accepted" | "rejected" | "unreviewed" {
  const feedback = new Map<number, "accepted" | "rejected">();
  reviews.flatMap(row => row.forestPaletteFeedback ?? []).sort((a, b) => a.at - b.at)
    .forEach(item => feedback.set(item.imageId, item.decision));
  const visited = new Set<number>();
  const rejected = (id: number): boolean => {
    if (visited.has(id)) return false;
    visited.add(id);
    // Explicit approval of this exact image can supersede an older rejected recipe.
    if (feedback.has(id)) return feedback.get(id) === "rejected";
    const parent = images.find(image => image.id === id)?.parentImageId;
    return Boolean(parent && rejected(parent)) || reviews.some(row =>
      row.forestPaletteApplications?.some(item => item.imageId === id && rejected(item.referenceImageId)));
  };
  return rejected(imageId) ? "rejected" : feedback.get(imageId) ?? "unreviewed";
}

/** Short follow-ups inherit the active cloud target, never the whole scene. */
export function isCloudAppearanceEdit(text: string) {
  return /(?:更|再|大|厚|白|多|少)(?:大|厚|白|多|少)?(?:一?点|些)|更大|更厚|更白|密集|稀疏|拥挤|高光|亮部|阴影|暗部|饱和度|纹理|重复|\b(?:bigger|larger|thicker|whiter|highlights?|shadows?|saturat\w*|textures?|repetit\w*|more clouds|fewer clouds|less dense|sparser|crowded)\b/i.test(text) &&
    !/范围|定位|识别|多选|少选|\b(?:scope|region|locate|select)\b/i.test(text);
}
export function cloudArtDirection(text: string, previous?: CloudArtDirection): CloudArtDirection {
  const direction = { quantity: previous?.quantity ?? "preserve", textureRepetition: previous?.textureRepetition ?? "preserve" } as CloudArtDirection;
  if (previous?.highlights) direction.highlights = previous.highlights;
  if (previous?.shadows) direction.shadows = previous.shadows;
  for (const clause of text.split(/[，,。；;\n]/)) {
    if (/多一点|多一些|再多|略多|稍多|稍微.*多|增加.*云|more clouds|additional clouds/i.test(clause)) direction.quantity = "slightly_more";
    if (/少一点|少一些|减少.*云|(?:云|数量).*减少|太密集|太拥挤|稀疏|疏一点|fewer clouds|less dense|sparser|too crowded/i.test(clause)) direction.quantity = "fewer";
    if (/不要减少|不减少|别减少|不要稀疏|do not reduce|don't reduce|no fewer clouds/i.test(clause)) direction.quantity = "preserve";
    if (/数量.*不变|不增加.*云|不要.*更多|keep.*(?:cloud )?count|no more clouds/i.test(clause)) direction.quantity = "preserve";
    if (/重复|复制|雷同|repetit|cloned|copy.past/i.test(clause)) direction.textureRepetition = "reduce";
    if (/纹理.*(?:不变|原样)|保留.*纹理|keep.*texture|preserve.*texture/i.test(clause)) direction.textureRepetition = "preserve";
    if (/(?:高光|亮部).*白|白(?:色|一点|一些)|white.*highlights?|highlights?.*white/i.test(clause)) direction.highlights = "white";
    if (/(?:阴影|暗部).*(?:五颜六色|彩色|多彩|丰富)|(?:colorful|multicolored|multi.colored).*shadows?|shadows?.*(?:colorful|multicolored)/i.test(clause)) direction.shadows = "colorful";
    if (/(?:高光|亮部).*(?:不变|原样)|(?:keep|preserve).*highlights?/i.test(clause)) direction.highlights = "preserve";
    if (/(?:阴影|暗部).*(?:不变|原样)|(?:keep|preserve).*shadows?/i.test(clause)) direction.shadows = "preserve";
  }
  return direction;
}
export function forestPaletteConsistencyDecision(text: string) {
  for (const clause of text.split(/[，,。；;\n]/)) {
    if (!/森林|树木|树冠|\b(?:forests?|trees?)\b/i.test(clause) || /吗|是否|[?？]/.test(clause)) continue;
    if (/不再统一|不要统一|各自配色|stop matching|independent palettes/i.test(clause)) return "release";
    if (/颜色.*一致|配色.*一致|统一.*(?:颜色|配色)|(?:same|consistent).*colou?rs?|match.*palette/i.test(clause)) return "lock";
  }
  return null;
}
export function isForestToneEdit(text: string) {
  return /太绿|过绿|绿得|降低绿感|绿(?:色|感).*(?:太满|太浓|太重)|降低.*饱和度|(?:树|森林).*(?:没(?:有)?层次|缺少层次)|too green|less green|reduce.*saturation|flat.*forest/i.test(text);
}
export function isForestGreenMatchEdit(text: string) {
  if (/不要统一|不再统一|各自配色|don't match|do not match/i.test(text)) return false;
  return /(?:绿|颜色|配色)[^。；;\n]*(?:不统一|不一致|更协调|协调统一)|统一[^。；;\n]*(?:绿|颜色|配色)|(?:森林|树木|树冠)[^。；;\n]*(?:颜色|配色)[^。；;\n]*一致|(?:match|harmonize|unify)[^.;\n]*(?:forest|green)|(?:forest|green)[^.;\n]*(?:inconsistent|consistent)/i.test(text);
}
export function cloudShapeDecision(text: string) {
  const value = text.trim().replace(/[。！!]+$/, "");
  if (/^(?:确认(?:生成(?:云层|云朵|这张图|这一张)?)?|生成云层|confirm(?: clouds?)?|generate clouds?)$/i.test(value)) return "generate";
  if (/^(?:查看云层|取回云层|恢复云层|show clouds?|resume clouds?)$/i.test(value)) return "recover";
  return null;
}
export function isFrameRegionReviewImage(review: FrameRegionReview | undefined, imageId: number) {
  return Boolean(review && (review.frames.some(frame => frame.imageId === imageId) ||
    review.sourceImages?.some(source => source.imageId === imageId) ||
    review.tasks.some(task => task.imageId === imageId || task.candidate?.imageId === imageId || task.shapeQuote?.sourceImageId === imageId)));
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
  let active: RegionTarget[] = [];
  const clauses = text.split(/[，,；;。\n]/).filter(clause => {
    const named = (Object.keys(words) as RegionTarget[]).filter(key => words[key].test(clause));
    if (named.length) active = named;
    return active.includes(target);
  });
  return clauses.length ? clauses.join("；") : text;
}
export function regionTemporalFrames(text: string, frames: { imageId: number }[]) {
  if (/第一帧|首帧|开头|面板.*飞出|first frame|opening|emerg/i.test(text)) return frames.slice(0, 2).map(frame => frame.imageId);
  if (/最后|结尾|末尾|尾帧|last|ending|final/i.test(text)) return frames.slice(-2).map(frame => frame.imageId);
  return frames.map(frame => frame.imageId);
}
