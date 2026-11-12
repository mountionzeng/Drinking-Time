import { z } from "zod";

export const visualReadingSchema = z.object({
  editPromptEnglish: z.string().max(6000).optional(),
  observed: z.string().min(1).max(800),
  change: z.array(z.string().max(240)).max(8).default([]),
  preserve: z.array(z.string().max(240)).max(10).default([]),
  uncertain: z.array(z.string().max(240)).max(5).default([]),
});
export type VisualReading = z.infer<typeof visualReadingSchema>;
export type VisualBrief = {
  id: string; contextVersion?: string; imageId: number; imageVersion: string; stableShotId: string | null;
  instruction: string; reading: VisualReading | null; model: string | null;
  /** Original paid reading reused for an otherwise identical edit-model/supplier switch. */
  reusedFromBriefId?: string;
  status: "seen" | "unavailable"; failure?: string; createdAt: number; editorUserId: number;
};
export type VisualPreferenceScope = "user" | "story" | "shot";
export function parseVisualUnderstandingChat(text: string) {
  const value = text.trim();
  const scope: VisualPreferenceScope = /我的|my\b/i.test(value) ? "user" : /这个镜头|本镜|this shot/i.test(value) ? "shot" : "story";
  const save = value.match(/^(?:请)?(?:记住|更新)(?:我的|这部作品的|这个镜头的|本片的)?(?:美术|视觉|改图)偏好\s*[:：]\s*([\s\S]+)$/)
    ?? value.match(/^(?:remember|update) (?:my|this story's|this shot's) visual preferences?\s*:\s*([\s\S]+)$/i);
  if (save) return { kind: "save" as const, scope, text: save[1].trim() };
  if (/^(?:请)?(?:查看|显示|忘记|清除)(?:我的|这部作品的|这个镜头的|本片的)?(?:美术|视觉|改图)偏好[。！]?$/u.test(value) || /^(?:show|forget) (?:my|this story's|this shot's) visual preferences?[.!]?$/i.test(value))
    return { kind: /忘记|清除|^forget/i.test(value) ? "forget" as const : "list" as const, scope };
  if (/(?:看看|看一下|看懂|分析|观察|读图|看到了什么|修改记录|修改边界|保留什么)/u.test(value) && /图|画面|修改记录|修改边界/.test(value) || /(?:inspect|describe|analy[sz]e).{0,30}(?:image|picture|frame)|what.*see.*(?:image|picture)|image edit history/i.test(value))
    return { kind: "inspect" as const, imageId: Number(value.match(/(?:图片|图|image)\s*#\s*(\d+)/i)?.[1]) || undefined };
  return null;
}

export function visualBriefReply(brief: VisualBrief, language = "zh") {
  const zh = language === "zh";
  const r = brief.reading;
  if (!r) return zh ? `图片 #${brief.imageId} 暂时未能读取。我已记录你的原话，但不会假装看过图片，也未提交生成。` : `Image #${brief.imageId} could not be read. Your request is recorded; no generation was submitted.`;
  return [
    `${zh ? "图片" : "Image"} #${brief.imageId} · ${zh ? "我看到" : "I see"}：${r.observed}`,
    `${zh ? "这次修改" : "Change"}：${r.change.join("；") || (zh ? "仅查看，尚未要求修改" : "Inspection only")}`,
    `${zh ? "保留" : "Preserve"}：${r.preserve.join("；") || (zh ? "未要求修改的内容" : "Everything not requested to change")}`,
    r.uncertain.length ? `${zh ? "尚不确定" : "Uncertain"}：${r.uncertain.join("；")}` : "",
  ].filter(Boolean).join("\n");
}

/** Preferences are guidance for requested edits, never permission to redesign. */
export function visualPreferencePrompt(preferences: string[], instruction: string) {
  return [
    "Edit only what the current user request explicitly asks. Preserve everything else, including brightness, grayscale/value structure, contrast, palette, layout, object positions and text unless explicitly requested otherwise.",
    preferences.length ? `Optional preferences (oldest to newest; only apply to requested changes; never override the current request or change other dimensions):\n${preferences.join("\n")}` : "",
    `Current user request (highest priority):\n${instruction}`,
  ].filter(Boolean).join("\n\n");
}
