import { z } from "zod";
import { parseColorTransferIntent } from "./colorTransferIntent";

export const chatFrameReferenceSchema = z.object({
  storyId: z.number().int().positive(),
  stableShotId: z.string().min(1),
  shotNo: z.number().int().positive(),
  imageId: z.number().int().positive(),
  imageUrl: z.string().min(1).refine(value => value.startsWith("/api/images/") || /^https?:\/\//i.test(value)),
  takeId: z.number().int().positive().optional(),
  origin: z.literal("paused-preview").optional(),
  sourceFrame: z.boolean().optional(),
  imageSize: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
  timelineVersion: z.number().int().nonnegative().optional(),
  timelineFrame: z.number().int().nonnegative(),
  sourceTimeSec: z.number().finite().nonnegative(),
  shotTimeSec: z.number().finite().nonnegative(),
});
export type ChatFrameReference = z.infer<typeof chatFrameReferenceSchema>;

/** Free inspection precedes image/video production, even when the brief mentions music or art. */
export function isFrameReferenceChat(text: string): boolean {
  if (/(?:不要|不用|别)\s*(?:抽\s*(?:[1-9一二三四五六七八九]\s*(?:张|个)?)?\s*帧|截帧)|\b(?:do not|don't)\s+extract/i.test(text)) return false;
  return /抽\s*(?:[1-9一二三四五六七八九]\s*(?:张|个)?)?\s*帧|截帧|(?:抽|提取|截取).{0,24}(?:参考帧|关键帧)|\b(?:extract|capture|grab).{0,35}\bframes?\b/i.test(text);
}

export function referenceFrameOffsets(text: string, durationFrames: number): number[] {
  const seconds = [...text.matchAll(/(?:第\s*)?(\d+(?:\.\d+)?)\s*(?:秒|seconds?\b|s\b)/gi)].map(match => Number(match[1]));
  if (seconds.length > 6) throw new Error("一次最多查看 6 个时间点 / Up to 6 frames at a time");
  if (seconds.length) {
    const frames = seconds.map(sec => Math.round(sec * 30));
    if (frames.some(frame => frame >= durationFrames)) throw new Error("时间超出当前镜头，请使用镜头内秒数 / Time is outside this shot");
    return [...new Set(frames)];
  }
  const countMatch = text.match(/(?:抽(?:取|出)?|提取|截取|extract|capture|grab)\s*([1-9一二三四五六七八九])\s*(?:张|个)?\s*(?:关键帧|参考帧|帧|(?:reference\s+|key\s*)?frames?)/i);
  if (countMatch) {
    const raw = countMatch[1];
    const count = /^\d$/.test(raw) ? Number(raw) : "零一二三四五六七八九".indexOf(raw);
    if (count > 6) throw new Error("一次最多查看 6 帧 / Up to 6 frames at a time");
    return [...new Set(Array.from({ length: count }, (_, i) => Math.round((durationFrames - 1) * (count === 1 ? .5 : i / (count - 1)))))];
  }
  return [...new Set([0.15, 0.5, 0.85].map(fraction => Math.min(durationFrames - 1, Math.floor(durationFrames * fraction))))];
}

export function explicitReferenceShotNumber(text: string): number | null {
  const matches = [...text.matchAll(/(?:第\s*)?([\d零一二三四五六七八九十两]+)\s*(?:个)?镜(?:头)?|(?:镜头|\bshot)\s*(\d+)/gi)];
  const digits = "零一二三四五六七八九";
  const values = matches.map(match => {
    const raw = (match[1] ?? match[2]).replace(/两/g, "二");
    if (/^\d+$/.test(raw)) return Number(raw);
    const parts = raw.split("十");
    return parts.length === 2 ? (parts[0] ? digits.indexOf(parts[0]) : 1) * 10 + (parts[1] ? digits.indexOf(parts[1]) : 0) : digits.indexOf(raw);
  });
  const unique = [...new Set(values)];
  if (unique.length > 1) throw new Error("请先指定一个镜头 / Choose one shot first");
  return unique[0] ?? null;
}

export const pausedFrameSnapshotSchema = z.object({
  storyId: z.number().int().positive(),
  timelineVersion: z.number().int().nonnegative(),
  timelineFrame: z.number().int().nonnegative(),
  hiddenVisualLayers: z.array(z.number().int().min(0).max(100)).max(100),
  width: z.number().int().min(1).max(8192),
  height: z.number().int().min(1).max(8192),
  imageMode: z.literal("source").optional(),
});
export type PausedFrameSnapshot = z.infer<typeof pausedFrameSnapshotSchema>;

/** Explicit named targets outrank the implicit playhead reference. */
export function hasExplicitFrameTarget(text: string): boolean {
  return /#\s*\d+|(?:图片|图像|image)\s*\d+|第\s*[\d一二三四五六七八九十]+\s*(?:张|镜)|\bshot\s*\d+/i.test(text);
}
export function usesPausedFrame(text: string): boolean {
  if (hasExplicitFrameTarget(text)) return false;
  return /(?:这|当前|停住的|暂停的)(?:一)?帧|(?:this|current|paused)\s+frame/i.test(text)
    && !/(?:不要|不用|别)(?:使用|用|改)?这(?:一)?帧|(?:don't|do not)\s+(?:use|change)\s+this frame/i.test(text);
}
export function pausedFrameEditRequested(text: string): boolean {
  return /改|调整|细腻|丰富|增加|减少|去掉|换成|更|change|edit|make|remove|add|replace/i.test(text)
    && !/怎么改|如何改|how (?:to|would|can)|不要改|不用改/i.test(text);
}

/** Explicit object-aware color analysis of a clicked candidate; ordinary local grading keeps its existing route. */
export function selectedObjectPaletteReference(text:string,selectedImageId?:number|null):number|null {
  if (!selectedImageId || !/按物体|逐物体|按对象|per.object|object.by.object/i.test(text) ||
      /[?？]|怎么|如何|是否|\bhow\b/i.test(text)) return null;
  const match=text.match(/(?:参考|参照|按|使用|用|reference|from)\s*(?:图片|图像|image)?\s*#\s*(\d+)\s*(?:的)?\s*(?:颜色|配色|色彩|colou?rs?|palette)/i);
  const reference=Number(match?.[1]);
  if (!reference || reference===selectedImageId || /(?:不要|别|不用)\s*(?:参考|参照|使用)|(?:don't|do not)\s+(?:use|reference)/i.test(text)) return null;
  const named=Array.from(text.matchAll(/#\s*(\d+)/g),m=>Number(m[1]));
  return named.every(id=>id===selectedImageId||id===reference) ? reference : null;
}

/** The attached frame stays the target; a clicked image contributes only its palette. */
export function framePaletteReferenceRequest(text: string, frameImageId: number, referenceImageId: number): string | null {
  if (frameImageId === referenceImageId ||
      /[?？]|怎么|如何|能否|是否|(?:不要|别|不用).{0,4}(?:参考|使用|采用)|\b(?:how|whether|don't|do not)\b/i.test(text)) return null;
  let resolved = text
    .replace(/@图片(?=\s*#)/g, "图片")
    .replace(/(?:这|当前|停住的|暂停的)(?:一)?帧|(?:this|current|paused)\s+frame/gi, `图片 #${frameImageId}`)
    .replace(/@图片|这张(?:图片|图)|选中(?:的)?(?:图片|图)|参考图|(?:this|selected|reference)\s+image/gi, `图片 #${referenceImageId}`);
  // A pinned frame already supplies the target when the user only names the reference.
  if (!hasExplicitFrameTarget(resolved.replaceAll(`图片 #${referenceImageId}`, "")))
    resolved += `，修改图片 #${frameImageId}`;
  const intent = parseColorTransferIntent(resolved);
  return intent?.kind === "transfer" && intent.source.kind === "image" &&
    intent.source.imageId === referenceImageId && intent.targets.length === 1 &&
    intent.targets[0].kind === "image" && intent.targets[0].imageId === frameImageId
    ? resolved : null;
}
