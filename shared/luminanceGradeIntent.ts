/**
 * 「只调亮度」—— 对话里的免费本地调整：亮度贴近参考图，色相锁死、HSL 饱和度不变。图片和视频共用。
 *
 * 例：「按图片 #2045 的亮度调图片 #2047」「图2只调亮度，参考图1」「视频 Take 1611 只调亮度」
 *     「第 3 镜的视频太暗了，提亮一点，颜色别动」「把图片 #2047 调亮，中档」
 *
 * 只认明确的「亮度」要求；夹带改内容、改颜色/饱和度/风格的要求 → 返回 null，整句照常走原来的（报价）流程。
 * 纯函数，前后端共用；不发请求、不读状态。
 */

export type LuminanceStrength = "mid" | "full";

export type LuminanceRef =
  | { kind: "ordinal"; index: number }
  | { kind: "image"; imageId: number }
  | { kind: "shot"; shotNo: number };

export type LuminanceGradeIntent =
  | { kind: "image"; reference?: LuminanceRef; targets: LuminanceRef[]; strengths: LuminanceStrength[] }
  | { kind: "video"; takeId?: number; shotNo?: number; referenceImageId?: number; referenceOrdinal?: number; strengths: LuminanceStrength[] }
  | { kind: "ask"; question: string };

const CN: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const num = (raw: string) => (/^\d+$/.test(raw) ? Number(raw) : CN[raw] ?? null);

function normalize(text: string): string {
  return text
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/＃/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

const BRIGHT = /只调亮度|只改亮度|只动亮度|只调明暗|只提亮|只压暗|亮度|明暗|提亮|调亮|变亮|亮一[点些]|亮些|太暗|偏暗|发暗|压暗|调暗|变暗|暗一[点些]|太亮|过曝|\bbrightness\b|\bbrighten\b|\blighten\b|\bdarken\b|\btoo dark\b/i;
/** 「色相/饱和度/颜色 不变」这类保留说明先去掉，再判断有没有夹带别的修改。 */
const KEEP = [
  /(?:色相|饱和度|颜色|色彩|色调|配色|hue|saturation|colou?rs?)(?:[和与、及跟,，/ ]*(?:色相|饱和度|颜色|色彩|色调|hue|saturation))*\s*(?:都|也)?\s*(?:不变|保持不变|保持|不动|别动|不要动|别改|不要改|不改|锁定|锁死|unchanged|locked)/gi,
  /(?:不要|别|不用|无需|不需要|不必|保持|保留|不改|不动|不变|锁定|锁死)[^，。,.;；!！?？]{0,12}/g,
];
const OTHER_CHANGE = new RegExp([
  "形状", "轮廓", "造型", "线条", "树", "云", "重画", "重绘", "重新画", "重新生成", "重做", "画清楚", "加上", "添加", "增加", "加一",
  "删除", "去掉", "删掉", "移除", "构图", "裁剪", "文字", "字体", "风格", "画风", "清晰", "锐化", "模糊", "细节", "姿势", "表情",
  "人物", "位置", "大小", "放大", "缩小", "旋转", "翻转", "背景", "饱和", "鲜艳", "色相", "颜色", "色彩", "色调", "配色", "暖", "冷", "对比",
  "镜头运动", "运镜", "动作", "时长", "重新生成视频",
  "\\b(?:shapes?|redraw|regenerate|add|remove|crop|composition|text|style|sharpen|blur|details?|pose|trees?|clouds?|background|saturat\\w*|hue|colou?rs?|contrast|warmer|cooler)\\b",
].join("|"), "i");

type Found = { ref: LuminanceRef; start: number; end: number };

const REF = /(?:图片|图像|image|img)?\s*#\s*(\d+)|(?:图片|图像)\s*(\d{3,})|第\s*([一二两三四五六七八九十\d]{1,3})\s*(张|幅|镜头|镜)|镜头\s*(\d{1,3})|图(?![片像])\s*([一二两三四五六七八九十\d]{1,3})(?![\d张幅镜])/gi;

function locate(text: string): Found[] {
  const out: Found[] = [];
  for (const m of text.matchAll(REF)) {
    const start = m.index ?? 0, end = start + m[0].length;
    let ref: LuminanceRef | null = null;
    if (m[1] || m[2]) ref = { kind: "image", imageId: Number(m[1] ?? m[2]) };
    else if (m[3]) { const n = num(m[3]); if (n) ref = /镜/.test(m[4]) ? { kind: "shot", shotNo: n } : { kind: "ordinal", index: n }; }
    else if (m[5]) ref = { kind: "shot", shotNo: Number(m[5]) };
    else if (m[6]) { const n = num(m[6]); if (n) ref = n >= 100 ? { kind: "image", imageId: n } : { kind: "ordinal", index: n }; }
    if (ref) out.push({ ref, start, end });
  }
  return out;
}

function strengthsOf(text: string): LuminanceStrength[] {
  const mid = /中档|半程|一半|稍微|稍稍|轻微|轻一点|一点点|\bmid\b|\bslightly\b/i.test(text);
  const full = /全档|完全|贴近|一样亮|同样亮|那样亮|那么亮|彻底|\bfull\b|\bmatch\b/i.test(text);
  if (mid && !full) return ["mid"];
  if (full && !mid) return ["full"];
  return ["mid", "full"];
}

const ASK = "请写清楚调哪张、按哪张的亮度，例如「按图片 #2045 的亮度调图片 #2047」或「视频 Take 1611 只调亮度」。还没有调整，也没有扣算力。";

export function parseLuminanceGradeIntent(input: string): LuminanceGradeIntent | null {
  const text = normalize(input);
  if (!text || text.length > 200 || !BRIGHT.test(text)) return null;
  if (/^(?:请)?(?:不要|别|先不|暂不)[^，。]{0,6}(?:调|改|提亮)/.test(text)) return null;
  if (/^(?:怎么|如何|为什么|能否|是不是|how\b|why\b)/i.test(text) || /[吗么]\s*[?？]?$/.test(text)) return null;
  let cleaned = text;
  for (const pattern of KEEP) cleaned = cleaned.replace(pattern, " ");
  if (OTHER_CHANGE.test(cleaned)) return null;
  // 「生成视频」「渲染」是付费制作，不在这里接。
  if (/生成|渲染|出图|制作|generate|render/i.test(cleaned)) return null;
  const strengths = strengthsOf(text);

  const takeMatch = /(?:take|视频)\s*#?\s*(\d{1,7})/i.exec(text);
  const isVideo = Boolean(takeMatch) || /视频|影片|片子|成片|\bvideo\b|\bclip\b|\btake\b/i.test(text);
  // Take 编号不算图片引用。
  const refText = takeMatch ? text.slice(0, takeMatch.index) + " ".repeat(takeMatch[0].length) + text.slice(takeMatch.index + takeMatch[0].length) : text;
  const found = locate(refText);
  const isReference = (item: Found) =>
    /^\s*(?:的)?\s*(?:亮度|明暗|那样亮|一样亮|那么亮|同样亮|brightness)/i.test(refText.slice(item.end)) ||
    /(?:参考|按照|按|照|对齐|贴近|像|跟|和|同|对准|match|like)\s*$/i.test(refText.slice(Math.max(0, item.start - 6), item.start)) &&
      /^\s*(?:的)?\s*(?:亮度|明暗|一样|那样|来)/.test(refText.slice(item.end)) ||
    /(?:参考|参照)\s*$/.test(refText.slice(Math.max(0, item.start - 4), item.start));
  // 「X 的亮度和 Y 一样」：Y 才是参考，X 是要调的图。
  const likeRefs = found.filter(item =>
    /(?:和|跟|同|像)\s*$/.test(refText.slice(Math.max(0, item.start - 3), item.start)) &&
    /^\s*(?:的)?\s*(?:亮度|明暗)?\s*(?:一样|一致|相同|那样|那么|同样)/.test(refText.slice(item.end)));
  const refs = likeRefs.length ? likeRefs : found.filter(isReference);
  if (refs.length > 1) return { kind: "ask", question: `只能按一张图的亮度来调。${ASK}` };
  const reference = refs[0]?.ref;
  const others = found.filter(item => !refs.includes(item)).map(item => item.ref);

  if (isVideo) {
    const shot = others.find((ref): ref is Extract<LuminanceRef, { kind: "shot" }> => ref.kind === "shot");
    if (reference?.kind === "shot") return { kind: "ask", question: `亮度参考请写图片编号（如「按图片 #2045 的亮度」）。${ASK}` };
    if (!takeMatch && !shot) return { kind: "video", strengths, ...(reference?.kind === "image" ? { referenceImageId: reference.imageId } : reference?.kind === "ordinal" ? { referenceOrdinal: reference.index } : {}) };
    return {
      kind: "video", strengths,
      ...(takeMatch ? { takeId: Number(takeMatch[1]) } : {}),
      ...(shot ? { shotNo: shot.shotNo } : {}),
      ...(reference?.kind === "image" ? { referenceImageId: reference.imageId } : reference?.kind === "ordinal" ? { referenceOrdinal: reference.index } : {}),
    };
  }
  const targets: LuminanceRef[] = [];
  for (const ref of others) if (!targets.some(t => JSON.stringify(t) === JSON.stringify(ref))) targets.push(ref);
  if (reference && targets.some(t => JSON.stringify(t) === JSON.stringify(reference))) return { kind: "ask", question: `参考图和要调的图是同一张。${ASK}` };
  if (targets.length > 8) return { kind: "ask", question: "一次最多调 8 张，请分几次说。还没有调整。" };
  const kinds = new Set([reference, ...targets].filter(Boolean).map(r => r!.kind));
  if (kinds.has("ordinal") && kinds.size > 1) return { kind: "ask", question: `图号和图片编号/镜号混在一起，我对不准是哪几张。${ASK}` };
  return { kind: "image", ...(reference ? { reference } : {}), targets, strengths };
}

// ── 回话 ──

const STRENGTH_LABEL: Record<LuminanceStrength, string> = { mid: "中档", full: "全档" };

export type LuminanceImageReplyItem =
  | { status: "ok"; targetImageId: number; referenceImageId: number; shotNo: number | null; awaitingDecision: boolean;
      candidates: Array<{ imageId: number; strength: LuminanceStrength; metrics?: { lMeanBefore: number; lMeanAfter: number; hueP95Deg: number; hslSMeanBefore: number; hslSMeanAfter: number } }> }
  | { status: "error"; targetImageId: number | null; target: string; error: string };

export function luminanceImageReply(input: { mapping?: string; results: LuminanceImageReplyItem[] }): string {
  const lines: string[] = [];
  if (input.mapping) lines.push(`对应关系：${input.mapping}。`);
  const ok = input.results.filter((r): r is Extract<LuminanceImageReplyItem, { status: "ok" }> => r.status === "ok");
  if (ok.length) lines.push("已在本机只调亮度：色相锁死、HSL 饱和度不变，0 算力，没有扣费；原图保留，没有自动替换。");
  for (const r of ok) {
    const shot = r.shotNo != null ? `第 ${String(r.shotNo).padStart(2, "0")} 镜 ` : "";
    const list = r.candidates.map(c => `${STRENGTH_LABEL[c.strength]} #${c.imageId}${c.metrics ? `（L ${c.metrics.lMeanBefore}→${c.metrics.lMeanAfter}）` : ""}`).join("，");
    lines.push(`- ${shot}图片 #${r.targetImageId}（参考 #${r.referenceImageId}）→ ${list}。`);
    lines.push(r.awaitingDecision
      ? `  要用哪张请回复「图片 #${r.candidates[0].imageId} 替换原图」${r.candidates[1] ? `或「图片 #${r.candidates[1].imageId} 替换原图」` : ""}，都不用就回复「${r.shotNo != null ? `第 ${r.shotNo} 镜` : ""}保留原图」。如果原图是首帧/尾帧，替换后会跟着换。`
      : "  这张图不在分镜镜头里，新图已存进素材仓库。");
  }
  for (const r of input.results) if (r.status === "error") lines.push(`- ${r.target}没有调整：${r.error}`);
  return lines.join("\n");
}

export type LuminanceVideoReplyItem = {
  takeId: number; parentTakeId: number; shotNo: number | null; referenceImageId: number; strength: LuminanceStrength; replayed?: boolean;
  metrics?: { lMeanBefore: number; lMeanAfter: number; referenceBodyLMean: number };
};

export function luminanceVideoReply(items: LuminanceVideoReplyItem[], errors: string[] = []): string {
  const lines: string[] = [];
  if (items.length) {
    const first = items[0];
    lines.push(`已在本机把视频 Take ${first.parentTakeId} 只调亮度（整片一条固定曲线，色相、饱和度不变，参考图片 #${first.referenceImageId}），0 算力，没有扣费。原 Take 保留，新版本还没有放入镜头：`);
    for (const item of items)
      lines.push(`- ${STRENGTH_LABEL[item.strength]}：新 Take ${item.takeId}${item.metrics ? `（平均亮度 L ${item.metrics.lMeanBefore}→${item.metrics.lMeanAfter}，参考 ${item.metrics.referenceBodyLMean}）` : ""}`);
    lines.push(`要用哪条请回复「采用视频 Take ${items[0].takeId}」${items[1] ? `或「采用视频 Take ${items[1].takeId}」` : ""}${first.shotNo != null ? `（第 ${first.shotNo} 镜）` : ""}；不用就不必理会，都保存在仓库。`);
  }
  for (const error of errors) lines.push(`- ${error}`);
  return lines.join("\n");
}
