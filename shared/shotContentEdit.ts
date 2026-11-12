/**
 * 「森林的树木品种太少了，而且我希望最后云层会比较厚」：一句话里按内容点名多张图。
 * 只做免费的本地解析与打分；真正改图前必须由用户看缩略图确认，再合并报价。
 */

export type ContentSubject = "forest" | "clouds" | "sky" | "city" | "water" | "noise" | "mountain";
export type ContentPosition = "first" | "middle" | "last";

export const CONTENT_SUBJECT_LABEL: Record<ContentSubject, string> = {
  forest: "森林", clouds: "云层", sky: "天空", city: "城市", water: "水面", noise: "彩色噪点", mountain: "山",
};

const SUBJECT_WORDS: Array<[ContentSubject, RegExp]> = [
  ["forest", /森林|树林|树木|树种|树冠|林子|植被|灌木|树/u],
  ["clouds", /云层|云海|云朵|彩云|云团|云/u],
  ["sky", /天空|蓝天|晴空/u],
  ["city", /城市|楼房|高楼|建筑|街道|房子|楼/u],
  ["water", /河流|河道|湖面|湖|大海|海面|水面|小河|河/u],
  ["noise", /噪点|彩点|点彩|彩色点|颗粒/u],
  ["mountain", /山脉|山峰|群山|山/u],
];
const POSITION_WORDS: Array<[ContentPosition, RegExp]> = [
  ["last", /最后|结尾|最终|末尾|结束时|尾帧|收尾/u],
  ["first", /开头|一开始|开始时|起始|首帧|第一帧|最初|起初/u],
  ["middle", /中间|中段|途中|过程中|中途/u],
];
const CHANGE_CUE = /太(?:少|多|暗|亮|单调|稀|密|薄|厚|小|大|单一|假|乱|空)|不够|不满意|希望|想要|想让|要(?:有|更|多|少|再)|改成|改为|换成|增加|加上|加点|加一些|减少|去掉|删掉|更(?:多|少|厚|薄|大|小|密|丰富|明显)|比较(?:厚|多|密|丰富|大|明显)|多一些|少一些|多一点|少一点|再.{0,4}(?:点|些)/u;
const CONNECTOR = /^(?:而且|并且|同时|另外|还有|然后|以及|再就是|并|且|和|也)\s*/u;
const BLOCKED = /#\s*\d+|视频|生成视频|只调亮度|提亮|调亮|压暗|调暗|变暗|拆(?:成|分)|拆镜|设为|首帧和尾帧|采用|替换原图|保留原图/u;

export type ContentEditClause = {
  clause: string;
  /** 原话（只去掉句首连接词），原样交给改图模型。 */
  instruction: string;
  subjects: ContentSubject[];
  position: ContentPosition | null;
};

/** An explicitly named image is an exact target, not a content-search hint. */
export function parseExplicitShotImageEdit(text: string): { shotNo: number; imageId: number } | null {
  const shot = /第\s*(\d+)\s*镜/.exec(text);
  const ids = [...text.matchAll(/(?:图片|图像|原图)\s*#\s*(\d+)/gu)];
  if (!shot || ids.length !== 1 || [...text.matchAll(/#\s*\d+/g)].length !== 1 || !/修改|精修|改图|细化/u.test(text) ||
    /采用|替换原图|保留原图|设为|拆镜|只调亮度|按.{0,30}亮度/u.test(text)) return null;
  const shotNo = Number(shot[1]), imageId = Number(ids[0][1]);
  return Number.isSafeInteger(shotNo) && shotNo > 0 && Number.isSafeInteger(imageId) && imageId > 0 ? { shotNo, imageId } : null;
}

function subjectsOf(text: string): ContentSubject[] {
  const found: Array<[number, ContentSubject]> = [];
  for (const [subject, pattern] of SUBJECT_WORDS) {
    const match = pattern.exec(text);
    if (match) found.push([match.index, subject]);
  }
  // 「树木」先命中 forest，避免「树」在别的词里重复命中。
  return [...new Set(found.sort((a, b) => a[0] - b[0]).map(([, subject]) => subject))];
}

function positionOf(text: string): ContentPosition | null {
  for (const [position, pattern] of POSITION_WORDS) if (pattern.test(text)) return position;
  return null;
}

/** 一句话 → 若干内容改图要求；不是这种句子就返回 null，交给原有流程。 */
export function parseShotContentEdits(text: string): ContentEditClause[] | null {
  const value = text.trim();
  if (!value || value.length > 300 || BLOCKED.test(value)) return null;
  if (/[吗呢]\s*[？?]?$/u.test(value) && !/希望|想要|改/u.test(value)) return null;
  const pieces = value.split(/[，,；;。！!？?\n]+|(?=而且|并且|同时|另外|还有|但(?:是)?(?:保留|保持|颜色|明暗|构图|其他))/u).map(piece => piece.trim()).filter(Boolean);
  // Preserve global negative constraints for every target, including clauses
  // before the first subject. A positive change to another image is not global.
  const constraints = pieces.filter(piece => /不变|不要变|别动|保持|保留|不要改|不改变|不添加|不要加/u.test(piece));
  const clauses: ContentEditClause[] = [];
  for (const piece of pieces.filter(piece => !constraints.includes(piece))) {
    const instruction = piece.replace(CONNECTOR, "").trim();
    if (!instruction) continue;
    const subjects = subjectsOf(instruction);
    const position = positionOf(instruction);
    const previous = clauses.at(-1);
    if (!subjects.length) {
      // 「森林太少，要多一些」：没有点名对象的半句跟着上一句。
      if (previous) {
        previous.instruction = `${previous.instruction}，${instruction}`;
        previous.clause = `${previous.clause}，${piece}`;
        previous.position ??= position;
      }
      continue;
    }
    clauses.push({ clause: piece, instruction, subjects, position });
  }
  const edits = clauses.filter(clause => CHANGE_CUE.test(clause.instruction));
  for (const edit of edits) {
    if (constraints.length) edit.instruction += `；${constraints.join("；")}`;
  }
  return edits.length ? edits : null;
}

// ── 免费打分：位置词 + 本镜视频要求里的先后顺序 + 本地颜色特征 ──

export type ShotImageSignature = {
  green: number; white: number; blue: number; cyan: number; gray: number; detail: number; brightness: number;
};
export type ShotImageCandidate = {
  imageId: number;
  imageUrl: string;
  role: "first" | "last" | "reference" | "current" | "other";
  /** 来源视频里的秒数或时间线位置，只用于排先后。 */
  timeSec: number | null;
  signature: ShotImageSignature | null;
};
export type ContentTargetProposal = {
  imageId: number;
  clauses: ContentEditClause[];
  instruction: string;
  reasons: string[];
  confidence: "high" | "low";
  alternatives: number[];
};

function subjectSignal(subject: ContentSubject, s: ShotImageSignature): number | null {
  switch (subject) {
    case "forest": return s.green;
    case "clouds": return s.white;
    case "sky": return s.blue;
    case "water": return s.blue + s.cyan;
    case "city": return s.gray;
    case "noise": return s.detail;
    default: return null;
  }
}

const ROLE_ORDER = { first: 0, current: 1, reference: 1, other: 1, last: 2 } as const;

/** 先后顺序：有时间用时间，否则首帧 < 参考帧 < 尾帧。 */
export function orderShotImages(images: ShotImageCandidate[]): ShotImageCandidate[] {
  return [...images].sort((a, b) =>
    a.timeSec != null && b.timeSec != null && a.timeSec !== b.timeSec ? a.timeSec - b.timeSec
      : ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.imageId - b.imageId);
}

/** 本镜视频要求里提到对象的先后，例如「城市、森林，再升入云海」。 */
export function briefSubjectOrder(brief: string): ContentSubject[] {
  const hits: Array<[number, ContentSubject]> = [];
  for (const [subject, pattern] of SUBJECT_WORDS) {
    const match = new RegExp(pattern.source, "gu").exec(brief);
    if (match) hits.push([match.index, subject]);
  }
  return hits.sort((a, b) => a[0] - b[0]).map(([, subject]) => subject);
}

export function scoreContentTargets(input: {
  clause: ContentEditClause;
  images: ShotImageCandidate[];
  brief: string;
}): Array<{ imageId: number; score: number; reasons: string[] }> {
  const ordered = orderShotImages(input.images);
  const n = ordered.length;
  const briefOrder = briefSubjectOrder(input.brief);
  return ordered.map((image, index) => {
    const reasons: string[] = [];
    let score = 0;
    const fraction = n > 1 ? index / (n - 1) : 0.5;
    if (input.clause.position) {
      const want = input.clause.position === "first" ? 0 : input.clause.position === "last" ? 1 : 0.5;
      const bonus = 1.2 * (1 - Math.min(1, Math.abs(fraction - want) * 2));
      if (bonus > 0) { score += bonus; reasons.push(input.clause.position === "last" ? "时间最靠后" : input.clause.position === "first" ? "时间最靠前" : "位于中段"); }
    }
    for (const subject of input.clause.subjects) {
      const rank = briefOrder.indexOf(subject);
      if (rank >= 0 && briefOrder.length > 1) {
        const want = rank / (briefOrder.length - 1);
        const bonus = 0.6 * (1 - Math.min(1, Math.abs(fraction - want) * 2));
        if (bonus > 0) { score += bonus; reasons.push(`视频要求里「${CONTENT_SUBJECT_LABEL[subject]}」排第 ${rank + 1}`); }
      }
      const values = input.images.map(item => item.signature ? subjectSignal(subject, item.signature) : null);
      const own = image.signature ? subjectSignal(subject, image.signature) : null;
      const known = values.filter((value): value is number => value != null);
      if (own != null && known.length > 1) {
        const min = Math.min(...known), max = Math.max(...known);
        if (max - min > 0.02) {
          const relative = (own - min) / (max - min);
          score += relative;
          if (relative > 0.66) reasons.push(`画面里${CONTENT_SUBJECT_LABEL[subject]}的颜色最多`);
        }
      }
    }
    return { imageId: image.imageId, score: Math.round(score * 1000) / 1000, reasons };
  }).sort((a, b) => b.score - a.score);
}

/** 每句选最高分的图；落在同一张图的几句合并成一个改图任务（一张图只付一次钱）。 */
export function proposeContentTargets(input: {
  clauses: ContentEditClause[];
  images: ShotImageCandidate[];
  brief: string;
}): ContentTargetProposal[] {
  const byImage = new Map<number, ContentTargetProposal>();
  for (const clause of input.clauses) {
    const scored = scoreContentTargets({ clause, images: input.images, brief: input.brief });
    const best = scored[0];
    if (!best) continue;
    const margin = best.score - (scored[1]?.score ?? 0);
    const existing = byImage.get(best.imageId);
    if (existing) {
      existing.clauses.push(clause);
      existing.instruction = `${existing.instruction}；${clause.instruction}`;
      existing.reasons.push(...best.reasons);
      if (margin < 0.3) existing.confidence = "low";
      continue;
    }
    byImage.set(best.imageId, {
      imageId: best.imageId, clauses: [clause], instruction: clause.instruction, reasons: [...best.reasons],
      confidence: margin >= 0.3 ? "high" : "low",
      alternatives: scored.slice(1).map(item => item.imageId),
    });
  }
  return [...byImage.values()];
}

// ── 确认回复 ──

export type ContentTargetReply =
  | { kind: "confirm" }
  | { kind: "cancel" }
  | { kind: "reassign"; subject: ContentSubject | null; ordinal: number | null; imageId: number }
  | { kind: "drop"; ordinal: number };

export function parseContentTargetReply(text: string): ContentTargetReply | null {
  const value = text.trim().replace(/[。.!！]+$/u, "");
  if (/^(?:对|对的|是|是的|没错|正确|确认|好|好的|可以|就这样|ok|yes|confirm)$/iu.test(value)) return { kind: "confirm" };
  if (/^(?:取消|不对|算了|先不|不要了|不改了|cancel|no)$/iu.test(value)) return { kind: "cancel" };
  const drop = value.match(/^(?:第\s*)?(\d+)\s*(?:条|项|个)?\s*(?:不改|不要|去掉|删掉)$/u);
  if (drop) return { kind: "drop", ordinal: Number(drop[1]) };
  const byOrdinal = value.match(/^(?:第\s*)?(\d+)\s*(?:条|项|个)\s*(?:改成|改为|换成|是|用|应该是)?\s*(?:图片\s*)?#\s*(\d+)$/u);
  if (byOrdinal) return { kind: "reassign", subject: null, ordinal: Number(byOrdinal[1]), imageId: Number(byOrdinal[2]) };
  const bySubject = value.match(/^(.{1,6}?)\s*(?:是|在|改成|改为|换成|用|应该是|对应)\s*(?:图片\s*)?#\s*(\d+)$/u);
  if (bySubject) {
    const subject = subjectsOf(bySubject[1])[0] ?? null;
    if (subject) return { kind: "reassign", subject, ordinal: null, imageId: Number(bySubject[2]) };
  }
  return null;
}

/** 来源时间：「源 7.233s」或「时间线帧 765」。 */
export function imageSourceTime(prompt: string | null | undefined): { sourceSec: number | null; timelineFrame: number | null } {
  const sec = prompt?.match(/源\s*(\d+(?:\.\d+)?)\s*s/u);
  const frame = prompt?.match(/时间线帧\s*(\d+)/u);
  return { sourceSec: sec ? Number(sec[1]) : null, timelineFrame: frame ? Number(frame[1]) : null };
}
