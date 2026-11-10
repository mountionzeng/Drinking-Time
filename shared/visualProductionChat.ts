export type VisualProductionIntent = {
  kind: "brief" | "image" | "video" | "adopt";
  shotCode?: string;
  imageId?: number;
  takeId?: number;
  timeline: boolean;
  briefField?: "videoPrompt" | "promptDraft";
};

/** A whole-image edit must keep the exact selected image and its revision flow. */
export function usesSelectedImageRevision(
  intent: VisualProductionIntent | null,
  selection?: { sourceType: string; imageId?: number | null; selection?: unknown } | null,
): boolean {
  return Boolean(intent && !intent.shotCode && !intent.briefField && (intent.kind === "brief" || intent.kind === "image") &&
    selection?.sourceType === "storyboard-image" && selection.imageId && !selection.selection);
}

/** Recognize operations, never art styles. The user's full prose is the brief. */
export function parseVisualProductionChat(text: string): VisualProductionIntent | null {
  const value = text.trim();
  if (!value) return null;
  const shotMatch = value.match(/第\s*(\d{1,6})\s*镜|(?:镜头|shot)\s*(\d{1,6})/i);
  const shotCode = shotMatch?.[1] ?? shotMatch?.[2];
  const imageId = Number(value.match(/(?:图片|图像|图|image)\s*#\s*(\d+)/i)?.[1]) || undefined;
  const takeId = Number(value.match(/(?:take|视频)\s*#?\s*(\d+)/i)?.[1]) || undefined;
  const timeline = /剪辑线|时间线|timeline/i.test(value);
  const base = { shotCode, imageId, takeId, timeline };
  // Saving motion requirements is distinct from purchasing a video, including
  // an explicit trailing "先保存，不生成".
  const opening = value.split(/[：:。！？\n]/)[0];
  if (/^(?:请)?(?:不要|别|先不|暂不|无需|不必|don't\b|do not\b)/i.test(opening)) return null;
  if (/音乐|配乐|旁白|有声书|字幕|音效|\bmusic\b|\bvoiceover\b/i.test(opening) &&
      !/图片|图像|画面|视频|影片|美术|视觉|\bimage\b|\bvideo\b/i.test(opening)) return null;
  if (/(?:视频要求|镜头动作|运动要求|video (?:brief|direction)|motion (?:brief|direction))/i.test(opening) &&
      /修改|调整|改成|改为|设为|更新|保存|change|update|save/i.test(opening) &&
      !/^(?:不要|别|先不|暂不|怎么|如何|don't|do not|how\b)/i.test(opening))
    return { ...base, kind: "brief", briefField: "videoPrompt" };
  if (/^(?:请)?(?:修改|编辑|调整|edit\b|change\b)/i.test(opening) && /图片|图像|画面|\bimage\b|\bpicture\b/i.test(opening))
    return { ...base, kind: "brief", ...(/(?:图片|图像|画面)要求/i.test(opening) ? { briefField: "promptDraft" as const } : {}) };
  const negated = /(?:不要|别|先不|暂不|无需|不必)[^，。；;\n]{0,16}(?:生成|渲染|出图|制作|采用|放入)|(?:do not|don't|not yet)\s+(?:generate|render|adopt)/i.test(value);
  if (negated || /^(?:怎么|如何|能否|可以吗|how\b|can you explain\b)/i.test(value)) return null;
  if (/(?:采用|确定用|就用|就这张|确定这张|选用|设为主图|放入|放到|加入|\badopt\b|\buse this\b|\bplace\b)/i.test(value) &&
      (imageId || takeId || /这张|这条|选中|当前图|当前视频|this (?:image|video)/i.test(value))) return { ...base, kind: "adopt" };
  const generate = /生成|渲染|出图|重画|画一|制作|generate|render|create/i.test(value);
  if (generate && /视频|影片|video|clip/i.test(value)) return { ...base, kind: "video" };
  if (generate && /图像|图片|画面|一张|出图|重画|image|picture|frame/i.test(value)) return { ...base, kind: "image" };
  if (/(?:画面|图片|图像|背景|视觉|美术|风格|色彩|色调|构图|image|background|visual|style|palette)/i.test(value) &&
      /希望|想要|改|调整|设为|整体|保持|沿用|want|change|make|keep|use/i.test(value)) return { ...base, kind: "brief" };
  return null;
}

/** Latest chat direction stays visible/editable in the existing versioned field. */
export function appendVisualProductionBrief(previous: string | null | undefined, instruction: string): string {
  const next = instruction.trim();
  const before = previous?.trim() ?? "";
  if (!before) return next;
  if (before === next || before.endsWith(`【最新对话要求】\n${next}`)) return before;
  return `${before}\n\n【最新对话要求】\n${next}`;
}
