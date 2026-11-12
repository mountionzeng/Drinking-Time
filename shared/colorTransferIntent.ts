/**
 * 「按图一的颜色改图二图三」—— 对话里的免费本地调色意图。
 *
 * 只认明确的套色句式，宁可漏掉（走原来的报价流程），也不把改内容的要求做成本地套色：
 * - 必须有一张「颜色的主人」：图X 的颜色/色调/配色/色彩，或「颜色改成 / 和 图X 一样」；
 * - 必须有动作词（改、调、套、用、统一、match、apply…）；
 * - 夹带改形状、加减物体、改亮度/对比/风格、再偏暖偏冷等要求 → 返回 null，整句照常走付费流程；
 * - 看得出是在套色、但图对不上（没说改哪张、源图也是目标、写了范围…）→ 只反问，不执行。
 *
 * 纯函数，前后端共用；不发请求、不读状态。
 */

export type ColorTransferRef =
  /** 对话引用栏里的第 N 张（图一 / 图1 / 第1张 / image 1）。homophone=「第N章」按「第N张」理解。 */
  | { kind: "ordinal"; index: number; raw: string; homophone?: boolean }
  /** generated_images.id（图片 #2045）。 */
  | { kind: "image"; imageId: number; raw: string }
  /** 分镜镜号（第 3 镜 / 镜头 3），由服务端换成该镜当前主图。 */
  | { kind: "shot"; shotNo: number; raw: string };

export type ColorTransferIntent =
  | { kind: "transfer"; source: ColorTransferRef; targets: ColorTransferRef[] }
  | { kind: "ask"; question: string };

/** 一次最多改几张（每张一次本地 submitRender）。 */
export const COLOR_TRANSFER_MAX_TARGETS = 8;

const CN_DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

export function parseSmallNumber(raw: string): number | null {
  const value = raw.trim();
  if (/^\d+$/.test(value)) return Number(value);
  if (!/^[零〇一二两三四五六七八九十]+$/.test(value)) return null;
  if (value === "十") return 10;
  const ten = value.indexOf("十");
  if (ten < 0) return value.length === 1 ? CN_DIGITS[value] ?? null : null;
  const tens = ten === 0 ? 1 : CN_DIGITS[value.slice(0, ten)];
  const ones = ten === value.length - 1 ? 0 : CN_DIGITS[value.slice(ten + 1)];
  if (tens == null || ones == null || value.slice(ten + 1).length > 1 || value.slice(0, ten).length > 1) return null;
  return tens * 10 + ones;
}

function normalize(text: string): string {
  return text
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/＃/g, "#")
    .replace(/[“”"「」『』]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const CN_N = "(?:[一二两三四五六七八九]?十[一二三四五六七八九]?|[零〇一二两三四五六七八九])";
const N = `(?:\\d{1,6}|${CN_N})`;
const SEP = "(?:\\s*(?:、|,|，|和|与|及|跟|以及|还有|\\band\\b|&|/)\\s*|\\s+)";
const COLOR = "(?:颜色|色调|配色|色彩|色系|色感|色盘|调色|colou?r\\s*(?:palette|grading|grade|scheme|tones?)|colou?rs?|palette|tones?)";

// 一个「引用」：可以是一组同类编号（第二、三张 / 图2和3 / 图片 #2046、#2047）。
const REF_SOURCE = [
  `(?<ids>(?:图片|图像|image|img|picture|pic)?\\s*#\\s*\\d+(?:${SEP}#?\\s*\\d+)*)`,
  `(?<idsBare>(?:图片|图像|image|img|picture)\\s*\\d{3,}(?:${SEP}#?\\s*\\d{3,})*)`,
  `(?<nth>第\\s*${N}(?:${SEP}(?:第\\s*)?${N})*\\s*(?:个\\s*)?(?:张|幅|章|镜头|镜))`,
  `(?<shot>(?:镜头|shot)\\s*${N}(?:${SEP}${N})*)`,
  `(?<tu>图(?![片像])\\s*${N}(?:(?:${SEP}(?:图(?![片像])\\s*)?|\\s*图(?![片像])\\s*)${N}(?![\\d张幅章镜]))*)`,
  `(?<en>(?:images?|imgs?|pictures?|pics?)\\s*\\d{1,2}(?!\\d)(?:${SEP}\\d{1,2}(?!\\d))*)`,
].join("|");

type Located = { refs: ColorTransferRef[]; start: number; end: number };

function expandMatch(match: RegExpExecArray): ColorTransferRef[] {
  const groups = match.groups ?? {};
  const raw = match[0];
  const numbers = (text: string) => Array.from(text.matchAll(new RegExp(N, "g")), m => parseSmallNumber(m[0])).filter((n): n is number => n != null);
  if (groups.ids || groups.idsBare) {
    return Array.from(raw.matchAll(/\d+/g), m => ({ kind: "image" as const, imageId: Number(m[0]), raw }));
  }
  if (groups.nth) {
    const unit = /(镜头|镜)$/.test(raw) ? "shot" : /章$/.test(raw) ? "chapter" : "ordinal";
    return numbers(raw.replace(/(?:个\s*)?(?:张|幅|章|镜头|镜)$/, "")).map(n =>
      unit === "shot" ? { kind: "shot" as const, shotNo: n, raw } : { kind: "ordinal" as const, index: n, raw, ...(unit === "chapter" ? { homophone: true } : {}) });
  }
  if (groups.shot) return numbers(raw.replace(/^(?:镜头|shot)/i, "")).map(n => ({ kind: "shot" as const, shotNo: n, raw }));
  if (groups.tu) {
    return Array.from(raw.matchAll(new RegExp(N, "g")), m => m[0]).map(text => {
      const n = parseSmallNumber(text)!;
      return /^\d{3,}$/.test(text) ? { kind: "image" as const, imageId: n, raw } : { kind: "ordinal" as const, index: n, raw };
    });
  }
  return Array.from(raw.replace(/^\D+/, "").matchAll(/\d{1,2}/g), m => ({ kind: "ordinal" as const, index: Number(m[0]), raw }));
}

function locateRefs(text: string): Located[] {
  const pattern = new RegExp(REF_SOURCE, "gi");
  const found: Located[] = [];
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (!match[0]) { pattern.lastIndex++; continue; }
    found.push({ refs: expandMatch(match), start: match.index, end: match.index + match[0].length });
  }
  return found;
}

const KEEP_CLAUSE = /(?:不要|别|不用|无需|不需要|不必|保持|保留|不改|不动|不变)[^，。,.;；!！?？]{0,12}/g;
const CONTENT_CHANGE = new RegExp([
  "形状", "轮廓", "造型", "线条", "外形", "树", "云", "重画", "重绘", "重新画", "重新生成", "重做", "画清楚", "画得",
  "加上", "添加", "增加", "加一", "删除", "去掉", "删掉", "移除", "擦掉", "构图", "裁剪", "裁切", "文字", "字体",
  "亮度", "明暗", "调亮", "调暗", "变亮", "变暗", "更亮", "更暗", "亮一", "暗一", "对比", "饱和", "风格", "画风",
  "清晰", "锐化", "模糊", "细节", "姿势", "表情", "人物", "位置", "大小", "放大", "缩小", "旋转", "翻转", "倒过来",
  "光影", "光线", "阴影", "质感", "材质", "纹理", "背景", "暖一", "冷一", "更暖", "更冷", "偏暖", "偏冷", "鲜艳", "淡一", "浓一",
  "\\b(?:shapes?|outlines?|redraw|re-draw|regenerate|reshape|add|remove|delete|erase|crop|composition|text|font|bright\\w*|dark\\w*|contrast|saturat\\w*|style|sharpen|blur|details?|pose|rotate|flip|trees?|clouds?|lighting|shadows?|texture|background|warmer|cooler)\\b",
].join("|"), "i");
const ACTION = /改|调|套|换|统一|应用|用|处理|变成|变为|做成|弄成|一样|一致|照|按|沿用|参照|参考|\b(?:match|use|apply|copy|recolou?r|make|change|transfer)\b/i;
const RANGE = new RegExp(`${N}\\s*(?:到|至|~|～|-|—)\\s*(?:第|图)?\\s*${N}`);

function sameRef(a: ColorTransferRef, b: ColorTransferRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "image" && b.kind === "image") return a.imageId === b.imageId;
  if (a.kind === "shot" && b.kind === "shot") return a.shotNo === b.shotNo;
  return a.kind === "ordinal" && b.kind === "ordinal" && a.index === b.index;
}

export function describeColorTransferRef(ref: ColorTransferRef): string {
  if (ref.kind === "image") return `图片 #${ref.imageId}`;
  if (ref.kind === "shot") return `第 ${ref.shotNo} 镜`;
  return `图${ref.index}`;
}

const ASK_REFS = "请写清楚按哪张图的颜色、改哪几张，例如「按图1的颜色改图2、图3」或「按图片 #2045 的颜色改图片 #2046」。还没有调色，也没有扣算力。";

export function parseColorTransferIntent(input: string): ColorTransferIntent | null {
  const text = normalize(input);
  if (!text || text.length > 200) return null;
  if (!new RegExp(COLOR, "i").test(text)) return null;
  const located = locateRefs(text);
  if (!located.length) return null;

  // 谁是「颜色的主人」（源图）
  const owners: Located[] = [];
  let sourceOverride: Located | null = null;
  for (const item of located) {
    const after = text.slice(item.end);
    const before = text.slice(0, item.start);
    if (new RegExp(`^\\s*(?:的|之|'s)?\\s*${COLOR}`, "i").test(after)) owners.push(item);
    else if (new RegExp(`${COLOR}\\s*(?:of|from)\\s*(?:the\\s*)?$`, "i").test(before)) owners.push(item);
    // 「图二的颜色改成图一的」「颜色和图一一样」：源图在后面
    const verbBefore = new RegExp(`${COLOR}\\s*(?:都|也|要)?\\s*(?:改成|换成|调成|统一成|变成|改为|调为|换为|统一为|弄成|做成|改得|调得)\\s*(?:和|跟|同|像)?\\s*$`, "i").test(before);
    const likeBefore = new RegExp(`${COLOR}\\s*(?:都|也|要)?\\s*(?:和|跟|同|像)\\s*$`, "i").test(before) &&
      new RegExp(`^\\s*(?:的\\s*(?:${COLOR})?)?\\s*(?:一样|一致|相同|统一|似的)`, "i").test(after);
    if (verbBefore || likeBefore) sourceOverride = item;
    else if (new RegExp(`\\b(?:to|like)\\s*$`, "i").test(before) && new RegExp(`^\\s*(?:'s)?\\s*${COLOR}`, "i").test(after)) sourceOverride = item;
  }
  const sourceItem = sourceOverride ?? (owners.length === 1 ? owners[0] : null);
  if (!sourceItem && owners.length === 0) return null;

  const cleaned = text.replace(KEEP_CLAUSE, " ");
  if (CONTENT_CHANGE.test(cleaned)) return null;
  if (!ACTION.test(text)) return null;

  if (!sourceItem || sourceItem.refs.length !== 1) return { kind: "ask", question: `只能按一张图的颜色来改。${ASK_REFS}` };
  if (RANGE.test(text)) return { kind: "ask", question: `请逐张列出要改的图（例如「图2、图3」），不要写范围。还没有调色，也没有扣算力。` };
  const source = sourceItem.refs[0];
  const targets: ColorTransferRef[] = [];
  for (const item of located) {
    if (item === sourceItem) continue;
    for (const ref of item.refs) if (!targets.some(t => sameRef(t, ref))) targets.push(ref);
  }
  if (!targets.length) return { kind: "ask", question: `要把哪几张改成${describeColorTransferRef(source)}的颜色？${ASK_REFS}` };
  if (targets.some(t => sameRef(t, source))) return { kind: "ask", question: `源图和要改的图是同一张（${describeColorTransferRef(source)}）。${ASK_REFS}` };
  if (targets.length > COLOR_TRANSFER_MAX_TARGETS) return { kind: "ask", question: `一次最多改 ${COLOR_TRANSFER_MAX_TARGETS} 张，请分几次说。还没有调色。` };
  const kinds = new Set([source, ...targets].map(r => r.kind));
  if (kinds.has("ordinal") && kinds.size > 1) return { kind: "ask", question: `图号和图片编号/镜号混在一起，我对不准是哪几张。${ASK_REFS}` };
  return { kind: "transfer", source, targets };
}

// ── 把「图1/图2」对到对话引用栏里的具体图片 ──

export type ColorTransferImageRef = { imageId: number; label?: string };
export type ResolvedColorTransferRef = { imageId: number } | { shotNo: number };
export type ColorTransferResolution =
  | { ok: true; source: ResolvedColorTransferRef; targets: ResolvedColorTransferRef[]; mapping: string }
  | { ok: false; question: string };

/** ordinal 按引用栏顺序（图1=第一张）对成 imageId；图片编号和镜号原样交给服务端核对。 */
export function resolveColorTransferRefs(
  intent: Extract<ColorTransferIntent, { kind: "transfer" }>,
  basket: readonly ColorTransferImageRef[]
): ColorTransferResolution {
  const notes: string[] = [];
  const resolve = (ref: ColorTransferRef): ResolvedColorTransferRef | string => {
    if (ref.kind === "image") return { imageId: ref.imageId };
    if (ref.kind === "shot") return { shotNo: ref.shotNo };
    const item = basket[ref.index - 1];
    if (!item) {
      return basket.length
        ? `对话引用栏里只有 ${basket.length} 张图，找不到图${ref.index}。`
        : `对话引用栏里还没有图，我不知道图${ref.index}指哪一张。`;
    }
    notes.push(`图${ref.index}${ref.homophone ? `（你说的「${ref.raw.replace(/\s/g, "")}」按第 ${ref.index} 张理解）` : ""}＝图片 #${item.imageId}`);
    return { imageId: item.imageId };
  };
  const source = resolve(intent.source);
  if (typeof source === "string") return { ok: false, question: `${source}请先把图加进引用栏，或直接写图片编号（如图片 #2045）。还没有调色，也没有扣算力。` };
  const targets: ResolvedColorTransferRef[] = [];
  for (const ref of intent.targets) {
    const target = resolve(ref);
    if (typeof target === "string") return { ok: false, question: `${target}请先把图加进引用栏，或直接写图片编号（如图片 #2046）。还没有调色，也没有扣算力。` };
    if ("imageId" in target && "imageId" in source && target.imageId === source.imageId)
      return { ok: false, question: `源图和要改的图是同一张（图片 #${source.imageId}）。${ASK_REFS}` };
    if (!targets.some(t => JSON.stringify(t) === JSON.stringify(target))) targets.push(target);
  }
  return { ok: true, source, targets, mapping: notes.join("，") };
}

// ── 结果回话 ──

export type ColorTransferItemResult =
  | { status: "ok"; targetImageId: number; imageId: number; imageUrl: string; shotNo: number | null; awaitingDecision: boolean }
  | { status: "error"; targetImageId: number | null; target: string; error: string };

export function colorTransferReply(input: { sourceImageId: number; mapping?: string; results: ColorTransferItemResult[] }): string {
  const lines: string[] = [];
  if (input.mapping) lines.push(`对应关系：${input.mapping}。`);
  const ok = input.results.filter((r): r is Extract<ColorTransferItemResult, { status: "ok" }> => r.status === "ok");
  if (ok.length) {
    lines.push(`已按图片 #${input.sourceImageId} 的颜色生成 ${ok.length} 张新版本，本地调色，0 算力，没有扣费；只改颜色，明暗、构图和物体都没动，原图保留。`);
    for (const r of ok) {
      const shot = r.shotNo != null ? `第 ${String(r.shotNo).padStart(2, "0")} 镜 ` : "";
      lines.push(r.awaitingDecision
        ? `- ${shot}图片 #${r.targetImageId} → 新图 #${r.imageId}。要用新图请回复「图片 #${r.imageId} 替换原图」，不用就回复「${r.shotNo != null ? `第 ${r.shotNo} 镜` : ""}保留原图」。`
        : `- 图片 #${r.targetImageId} → 新图 #${r.imageId}（已存进素材仓库；这张图不在分镜镜头里，需要替换请在仓库里操作）。`);
    }
  }
  for (const r of input.results) {
    if (r.status === "error") lines.push(`- ${r.target}没有调色：${r.error}`);
  }
  return lines.join("\n");
}
