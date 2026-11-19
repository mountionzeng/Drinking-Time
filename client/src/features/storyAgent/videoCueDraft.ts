import { inlineChatImageIds, inlineChatParts } from "@shared/inlineChatImages";
import { parseVisualProductionChat } from "@shared/visualProductionChat";
import { needsObjectOrigin, videoObjectOrigin, type ObjectOrigin } from "@shared/videoObjectOrigin";
import { cueRanges, retimeCues } from "@shared/videoCueTiming";

export function reviewTakeId(text:string) {
  return Number(text.trim().match(/^(?:复核|回看|查看)\s*(?:候选)?视频\s*Take\s*#?(\d+)\b/i)?.[1]) || undefined;
}

export function requestsVideoCues(text: string) {
  if (reviewTakeId(text)) return true;
  const plain = text.replace(/\[\[ref:[^\]]+\]\]/g, "").replace(/从新(?=渲染)/g, "重新").trim();
  if (/(生成|渲染|绘制|改|制作)(?:\d+张)?(?:图片|图像|海报)|(?:已确认|已审阅)的?(?:关键帧|范围)|用确认的范围/.test(plain.split(/[，。；]/)[0])) return false;
  if (/^(?:为什么|为何|怎么|如何|是否|查看|查询|取消|停止)|(?:暂不|先不|无需|不要|不用|别)\s*(?:再|重新)?(?:生成|渲染|制作)(?:视频|镜头)?|(?:视频|渲染)(?:失败|进度|状态)|already rendering|do not render/i.test(plain)) return false;
  if (needsObjectOrigin(plain) && /重新渲染|重拍|重做(?:视频|镜头)/.test(plain) &&
      !/渲染\s*(?:这|那)?(?:\d+|几)?张?(?:图片?|图像|海报)|重做(?:图片?|图像|海报)/.test(plain)) return true;
  return /(?:重(?:新)?渲染|重做|再做|重拍|渲染)\s*(?:第\s*)?(?:SH)?\d+\s*镜(?:头)?/i.test(plain) ||
    (parseVisualProductionChat(plain)?.kind === "video" &&
      (/逐秒|每一?秒|秒数|时长|关键帧|参考.{0,5}(?:这些|这两张|所选)|选中的图/.test(plain) || cueReferences(text).length >= 2));
}

export function cueTarget<T extends { shotNo: number; cueCode?: string | null; stableShotId?: string | null; shotIdentity?: string | null }>(
  text: string, shots: readonly T[], selectedId?: string | null,
) {
  const codes = [...new Set([...text.matchAll(/(?:第\s*)?(?:SH)?(\d{1,6})\s*镜|(?:镜头|\bshot)\s*(?:SH)?(\d{1,6})|\bSH(\d{1,6})\b/gi)].map(match => Number(match[1] || match[2] || match[3])))];
  if (!codes.length) return selectedId ? shots.find(shot => (shot.stableShotId ?? shot.shotIdentity) === selectedId) : undefined;
  if (codes.length !== 1) return undefined;
  const found = shots.filter(shot => Number((shot.cueCode || String(shot.shotNo)).replace(/^SH/i, "")) === codes[0]);
  return found.length === 1 ? found[0] : undefined;
}

export type CueMessage = { id: string; role: string; content: string; selectionQuote?: { storyId?: number | null; stableShotId?: string | null } };
export const cueReplyId = (id: string) => "video-cues:" + id;
export function currentCueTurn(messages: CueMessage[], storyId: number) {
  for (let index = messages.length - 1; index > 0; index--) {
    const reply = messages[index], request = reply.id.startsWith("video-cues:")
      ? messages.find(row => cueReplyId(row.id) === reply.id) : messages[index - 1];
    if (reply.role !== "assistant" || request?.role !== "user" || request.selectionQuote?.storyId !== storyId) continue;
    if (reply.id === cueReplyId(request.id) || /没接住你说的/.test(reply.content) && requestsVideoCues(request.content)) {
      try { cueReferences(request.content); } catch { continue; }
      return { reply, request };
    }
  }
}

export function cueBrief(text: string) {
  return inlineChatParts(text).filter(part => !part.imageId).map(part => part.text).join("").trim();
}
export function cueReferences(text: string) {
  return [...new Set([...inlineChatImageIds(text), ...[...text.matchAll(/(?:图片|image)\s*#(\d+)/gi)].map(match => Number(match[1]))])];
}

export function explicitFirstFrame(text:string) {
  const match=text.match(/(?:图片\s*)?#(\d+)\s*(?:为|作(?:为)?|用作|是)\s*首帧|首帧\s*(?:使用|用|是|为|[:：])?\s*(?:图片\s*)?#(\d+)/);
  return match?Number(match[1]??match[2]):undefined;
}
export function resizeCueFrames(ids:number[],oldCount:number,newCount:number) {
  if(oldCount<2 || newCount<2 || oldCount===newCount) return ids;
  return [ids[0]??0,...Array.from({length:newCount-2},(_,i)=>i<oldCount-2?(ids[i+1]??0):0),ids[oldCount-1]??0];
}

export function proposedSeconds(text: string, original: number) {
  const direct = text.match(/(?:总(?:时)?长|总共|共|时长|做成|改为|改成|生成|制作|视频)\s*(?:约|为)?\s*(\d+)\s*秒/);
  const durations = [...text.matchAll(/(?<![\d.第–至到-])(\d+)(?![\d.])\s*秒(?![钟内后前到至–-])/g)];
  if (direct || durations.length === 1) return Number(direct?.[1] ?? durations[0][1]);
  return Math.max(1, Math.ceil(original || 6) + (/长一?点|长一些|稍长|longer/i.test(text) ? 1 : 0));
}
export function secondDefaults(text: string, total: number, fallback = "") {
  const clauses = cueBrief(text).replace(/^(?:请|帮我)?(?:重新)?(?:渲染|生成|制作)\s*(?:第)?(?:SH)?\d*\s*(?:镜头?|视频)?[，,：:]?/i, "")
    .split(/[，,。；;\n]+/).map(clause => clause.trim()).filter(Boolean);
  const scenes = clauses.filter(clause => !/^(?:另外)?(?:全程)?(?:不要|不用|不出现|只需|只保留|保持|保留|避开)|(?:时间|时长|多少秒|秒钟|比.*镜长|先看报价)|(?:首帧|尾帧|参考|沿用|接第\s*\d+\s*镜).{0,12}#\d+|^从\s*#\d+\s*接|^(?:图片|图像)\s*#\d+/.test(clause));
  const phrases = scenes.length ? scenes : fallback && fallback !== "新增镜头" ? [fallback] : [];
  // An initial proposal may contain more clauses than seconds. Keep the full
  // brief editable even when it needs the author's help to fit one cue.
  try { return retimeCues(phrases,total); }
  catch { return Array.from({length:total},()=>""); }
}
export function cueDurations(total: number, minSegments = 1) {
  if (!Number.isInteger(total) || total < 1 || total > 32) return [];
  const segments = Math.max(minSegments, Math.ceil(total / 8));
  if (segments > 4 || segments > total) return [];
  return Array.from({ length: segments }, (_, index) => Math.floor(total / segments) + (index < total % segments ? 1 : 0));
}
export function splitCues(lines: string[], durations: number[]) {
  if (!durations.length || durations.reduce((sum, value) => sum + value, 0) !== lines.length ||
      lines.some(line => !line.trim() || line.trim().length > 120)) throw new Error("每秒需要一行画面说明（每行 1–120 字），请核对总时长。");
  let at = 0;
  return durations.map(seconds => { const part = lines.slice(at, at + seconds).map(value => value.trim()); at += seconds; return part; });
}

export type VideoCueDraft = { total: number; lines: string; prompt: string; ids: number[]; singleOpening?: boolean; objectOrigin?:ObjectOrigin };
export function originLine(origin:ObjectOrigin) {
  const r=origin.rect;
  return "变形来源："+origin.label+" · #"+origin.imageId+" · "+[r.x,r.y,r.w,r.h].map(n=>n.toString()).join(" / ");
}
export function readOriginLine(text:string) {
  const match=/^变形来源：([^\n]+) · #(\d+) · ([\d.e+-]+) \/ ([\d.e+-]+) \/ ([\d.e+-]+) \/ ([\d.e+-]+)$/m.exec(text);
  if(!match)return;
  const result=videoObjectOrigin.safeParse({label:match[1],imageId:Number(match[2]),rect:{x:Number(match[3]),y:Number(match[4]),w:Number(match[5]),h:Number(match[6])}});
  return result.success?result.data:undefined;
}
export function priorObjectOrigin(messages:CueMessage[],storyId:number,shotId:string,imageId:number|undefined) {
  for(let i=messages.length-1;i>=0;i--) {
    const m=messages[i];
    if(m.role!=="assistant" || !m.id.startsWith("video-cues:") || m.selectionQuote?.storyId!==storyId || m.selectionQuote.stableShotId!==shotId)continue;
    const origin=readOriginLine(m.content);
    if(origin && origin.imageId===imageId)return origin;
  }
}
export function cueTranscript(draft: VideoCueDraft, anchors: number[]) {
  return ["视频逐秒确认稿 · " + draft.total + " 秒（待确认，未渲染）", draft.prompt, ...(draft.objectOrigin ? [originLine(draft.objectOrigin)] : []), "关键帧：" + anchors.map(id => id ? "#" + id : "待选").join(" → "),
    ...cueRanges(draft.lines.split("\n")).map(({start,end,text}) => start + "–" + end + " 秒：" + text)].join("\n");
}
export function readCueTranscript(text: string): VideoCueDraft | undefined {
  const match = /^视频逐秒确认稿 · (\d+) 秒（待确认，未渲染）\n([\s\S]*?)\n关键帧：((?:#\d+|待选)(?: → (?:#\d+|待选))*)\n([\s\S]+)$/.exec(text);
  if (!match) return;
  const total = Number(match[1]), lines: string[] = [];
  if (total < 1 || total > 32) return;
  for (const row of match[4].split("\n")) {
    const span = /^(\d+)–(\d+) 秒：(.*)$/.exec(row);
    if (!span || Number(span[1]) !== lines.length) return;
    const end = Number(span[2]);
    if (end <= lines.length || end > total) return;
    while (lines.length < end) lines.push(span[3]);
  }
  if (lines.length !== total) return;
  const origin=readOriginLine(match[2]);
  const ids = match[3].split(" → ").map(value => value === "待选" ? 0 : Number(value.slice(1)));
  return { total, lines: lines.join("\n"), prompt:origin?match[2].replace("\n"+originLine(origin),""):match[2], ids, ...(ids.length===1?{singleOpening:true}:{}), ...(origin?{objectOrigin:origin}:{}) };
}
