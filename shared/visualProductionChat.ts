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

// ── 对话里的视频要求同步到结构化字段 ──
// 首尾帧视频（以及单图视频）只要「画面动作 / 运镜 / 开始画面 …」里有值，就以这些字段为准、忽略 videoPrompt。
// 所以对话里写的视频要求要同时写进「画面动作」（最高优先级），并清掉导入 ChatCut 时留下的素材说明。

export const MOTION_FIELDS = ["action", "cameraMove", "videoStart", "videoEnd", "transitionIn", "transitionOut"] as const;
export type MotionField = (typeof MOTION_FIELDS)[number];
export const MOTION_FIELD_LABEL: Record<MotionField, string> = {
  action: "画面动作", cameraMove: "运镜", videoStart: "开始画面", videoEnd: "结束画面", transitionIn: "承接上一镜", transitionOut: "进入下一镜",
};

/** 只认得出的 ChatCut 导入说明（素材文件名、源入点/出点、XML 清单），其他内容一律当作用户写的，不动。 */
export function isChatCutResidue(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  if (!text) return false;
  return /^使用素材\s*\S+\.(?:mp4|mov|webm|m4v)$/i.test(text) ||
    /^源[入出]点\s*\d+(?:\.\d+)?\s*s$/i.test(text) ||
    /^按\s*ChatCut\s*XML\s*清单$/i.test(text);
}

/** 从对话里取出视频要求本身；只有命令（「第 3 镜生成视频」）没有内容时返回 null，不覆盖已有动作。 */
export function motionBriefText(instruction: string): string | null {
  const value = instruction.trim();
  const colon = value.search(/[：:]/);
  const body = (colon >= 0 && colon < 30 && /视频要求|镜头动作|运动要求|视频|生成|渲染|video|motion/i.test(value.slice(0, colon))
    ? value.slice(colon + 1).trim() : value).replace(/[，,。；;]?\s*(?:先保存|只保存|先不生成|暂不生成|不生成视频|不要生成|别生成)[^。！!]*[。！!]?/g, "").trim();
  const residue = body
    .replace(/(?:请|帮我|麻烦)?(?:修改|调整|更新|保存|改成|改为|设为)?/g, "")
    .replace(/第\s*\d{1,6}\s*镜|镜头\s*\d{1,6}|shot\s*\d{1,6}/gi, "")
    .replace(/(?:重新)?(?:生成|渲染|制作)(?:视频|影片)?|视频要求|镜头动作|的?视频|generate|render|video/gi, "")
    .replace(/[\s，。,.!！?？;；:：、]/g, "");
  return residue.length >= 6 ? body.slice(0, 2000) : null;
}

export type MotionFieldSync = { updates: Partial<Record<MotionField, string>>; cleared: Array<{ field: MotionField; value: string }>; kept: Array<{ field: MotionField; value: string }> };

/**
 * 有结构化字段时才需要同步（没有字段时 videoPrompt 本来就生效，保持原样）。
 * 画面动作写成这次的要求；其他字段只清掉 ChatCut 残留，用户自己写的保留并列出来。
 */
export function syncMotionFields(fields: Partial<Record<MotionField, string | null | undefined>>, brief: string): MotionFieldSync | null {
  const present = MOTION_FIELDS.filter(field => (fields[field] ?? "").trim());
  if (!present.length) return null;
  const updates: MotionFieldSync["updates"] = { action: brief };
  const cleared: MotionFieldSync["cleared"] = [];
  const kept: MotionFieldSync["kept"] = [];
  for (const field of present) {
    const value = (fields[field] ?? "").trim();
    if (field === "action") { if (isChatCutResidue(value)) cleared.push({ field, value }); continue; }
    if (isChatCutResidue(value)) { updates[field] = ""; cleared.push({ field, value }); }
    else kept.push({ field, value });
  }
  return { updates, cleared, kept };
}

export function motionSyncReply(sync: MotionFieldSync): string {
  const parts = ["已同步写入「画面动作」（首尾帧视频以它为准）"];
  if (sync.cleared.length) parts.push(`清掉了 ChatCut 导入残留：${sync.cleared.map(item => `${MOTION_FIELD_LABEL[item.field]}「${item.value}」`).join("、")}`);
  if (sync.kept.length) parts.push(`保留了你原有的：${sync.kept.map(item => `${MOTION_FIELD_LABEL[item.field]}「${item.value.slice(0, 40)}」`).join("、")}（与画面动作冲突时以画面动作为准）`);
  return `${parts.join("；")}。`;
}
