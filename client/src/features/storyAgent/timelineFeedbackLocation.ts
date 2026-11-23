import type { SelectionContext } from "@shared/selectionContext";
import { explicitReferenceShotNumber } from "@shared/chatFrameReference";
import { parseDialogueVisualSync } from "@shared/dialogueVisualSync";
import { looksLikeVideoFeedback } from "@shared/localVideoFeedback";
import { parseSoundChat } from "@shared/soundChat";
import { formatStoryboardTimestamp, storyboardTimingWinnerAt, type StoryboardTimingRow } from "./storyboardTiming";
import type { SubtitleCue } from "@shared/timelineSubtitleModel";
import { TIMELINE_FPS } from "@shared/timelineViewport";

const names = { visual: "画面", music: "音乐", narration: "旁白" } as const;
type Track = keyof typeof names;
type Span = { startMs: number; endMs: number };
export type FeedbackClock = {
  storyId: number;
  version: number;
  positionMs: number;
  playing: boolean;
  totalMs: number;
  range: Span | null;
  rows: readonly StoryboardTimingRow[];
  hidden: readonly number[];
  cues: readonly Pick<SubtitleCue, "text" | "startFrame" | "durationFrames">[];
};
type Editor = {
  read: () => FeedbackClock;
  focus: (span: Span, tracks: Track[]) => string;
};
const editors = new Map<number, Editor>();
export function registerFeedbackEditor(storyId: number, editor: Editor) {
  editors.set(storyId, editor);
  return () => { if (editors.get(storyId) === editor) editors.delete(storyId); };
}
export function readFeedbackClock(storyId: number | null) {
  return storyId == null ? null : editors.get(storyId)?.read() ?? null;
}

const terms: Record<Track, RegExp> = {
  music: /背景音(?:乐)?|音乐|配乐|伴奏|节拍|\bmusic\b|\bbgm\b/iu,
  narration: /旁白|人声|语音|说话声|台词|配音|对白|解说|语速|朗读|\b(?:narration|voiceover|voice-over)\b/iu,
  visual: /画面|视频|图片|图像|镜头运动|运镜|构图|镜头|\b(?:picture|visuals?|video)\b/iu,
};
const tracksIn = (text: string) => (Object.keys(terms) as Track[]).filter(key => terms[key].test(text));
const pointAt = /这里|这儿|此处|这一?段|这个位置|这一?句|刚才|现在|此时|当前|\bhere\b/iu;
const locateOnly = /定位|标记|标一下|只记录|暂不修改|\b(?:locate|mark)\b/iu;
const playbackFeedback = /(?:太|有点)[快慢早晚大小高低响暗亮吵闷重]|[快慢早晚亮暗轻响大小高低](?:了|一些|一点|点)|提前|提早|推迟|延后|听不清|卡顿|卡[了住一]|闪[了一]|抖|刺耳|抢拍|不同步|对不上|跳帧|掉拍|\b(?:quieter|louder|slower|faster|delay)\b/iu;
const scopedDirection = /想改|要改|需要改|(?:改|调整|换)(?:一?下|掉)|音量|淡入|淡出|静音|后移|前移|节奏不对/u;
const targetWord = Object.values(terms).map(re => re.source).join("|");
function editTargets(text: string) {
  // Remove reference clauses on either side of the requested change.
  const action = text
    .replace(/[“「"][^”」"]+[”」"]/gu, "")
    .replace(/(?:随着|伴随|跟着|配合|参照|参考|按照|跟随|跟|随)(?:这句|这段|当前|背景|原有|原来的|的|\s)*(?:旁白|台词|音乐|配乐|画面)(?:的)?(?:节奏|节拍|速度|出现)?/gu, "")
    .replace(/(?:旁白|台词|音乐|画面)(?:响起|出现|开始|结束|说完|说到)(?:的)?(?:时候|时)/gu, "")
    .replace(new RegExp("(?:别|不要|不用|不必|不)(?:再)?(?:动|改|调|是)(?:的|原来的|原有|背景|这段)*(" + targetWord + ")", "giu"), "")
    .replace(new RegExp("(" + targetWord + ")(?:保持不变|保持原样|照旧|不变|不动|别动|不改|不用改|不要改)", "giu"), "")
    .replace(/(?:第\s*)?[\d零一二两三四五六七八九十]+\s*镜(?:头)?|镜头\s*\d+/gu, "");
  return tracksIn(action);
}

const numeral = "(?:\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百]+)";
const clock = "\\d{1,3}[:：][0-5]\\d(?:\\.\\d{1,3})?";
const minutes = numeral + "\\s*分(?:钟)?\\s*(?:" + numeral + "\\s*秒)?";
const timeToken = "(?:" + clock + "|" + minutes + "|" + numeral + "\\s*秒?)";
const timeRange = new RegExp("(?:第\\s*)?(" + timeToken + ")\\s*(?:至|到|[-–—~～])\\s*(?:第\\s*)?(" + timeToken + ")", "gu");
const timePoint = new RegExp(clock + "|" + minutes + "|(?:第\\s*)?" + numeral + "\\s*秒", "gu");
function timeTokenMs(token: string): number {
  const minute = token.match(/^(.+?)分(?:钟)?(.*)$/u);
  if (minute) return timeTokenMs(minute[1]) * 60 + (minute[2].trim() ? timeTokenMs(minute[2]) : 0);
  const value = token.replace(/[第秒\s]/gu, "").replace("：", ":");
  if (value.includes(":")) {
    const [minutes, seconds] = value.split(":").map(Number);
    return Math.round((minutes * 60 + seconds) * 1000);
  }
  if (/^\d/u.test(value)) return Math.round(Number(value) * 1000);
  let total = 0, digit = 0;
  for (const char of value.replaceAll("两", "二").replaceAll("〇", "零")) {
    if (char === "十" || char === "百") {
      total += (digit || 1) * (char === "十" ? 10 : 100);
      digit = 0;
    } else digit = "零一二三四五六七八九".indexOf(char);
  }
  return (total + digit) * 1000;
}
function explicitSpans(text: string): Span[] {
  const spans: Span[] = [];
  const rest = text.replace(timeRange, (match, first: string, last: string) => {
    if (!/[分秒:：]/u.test(match)) return match;
    spans.push({ startMs: timeTokenMs(first), endMs: timeTokenMs(last) });
    return " ";
  });
  for (const m of rest.matchAll(timePoint)) {
    // A delay, fade length or destination is not the source position.
    if (/(?:提前|推迟|延后|延迟|后移|前移|晚|早|推后|慢|快|延长|缩短|延至|持续|淡入|淡出|移动|移|挪|停顿)(?:了|到|至|为|约|大约|\s)*$/u.test(rest.slice(0, m.index))) continue;
    spans.push({ startMs: timeTokenMs(m[0]), endMs: timeTokenMs(m[0]) });
  }
  return spans;
}
function timeLabel(pos: number) { return formatStoryboardTimestamp(pos).replace(/\.000$/u, "").replace(/(\.\d*[1-9])0+$/u, "$1"); }

function spanLabel(span: Span) {
  return timeLabel(span.startMs) + (span.endMs > span.startMs ? "–" + timeLabel(span.endMs) : "");
}

const prefix = "feedback-position:";
type Quote = Pick<SelectionContext, "sourceType" | "sourceId" | "selection" | "storyId" | "selectedText">;
export function isFeedbackQuote(quote?: { sourceId?: string } | null) {
  return Boolean(quote?.sourceId?.startsWith(prefix));
}
function quoteTracks(quote: {sourceId: string}) {
  return quote.sourceId.slice(prefix.length).split(":")[1]?.split(",").filter((t): t is Track => Object.hasOwn(names, t)) ?? [];
}
function quotedSpan(quote: Pick<Quote, "sourceId" | "selection">): Span | null {
  if (quote.selection?.kind !== "time") return null;
  const [, , start, end] = quote.sourceId.slice(prefix.length).split(":");
  if (start !== undefined && end !== undefined && Number(start) === Number(end) && Number.isFinite(Number(start)))
    return { startMs: Number(start), endMs: Number(end) };
  return { startMs: quote.selection.startSec * 1000, endMs: quote.selection.endSec * 1000 };
}

export function locateTimelineFeedback(text: string, snapshot: FeedbackClock, previous?: Quote) {
  const last = previous?.storyId === snapshot.storyId && isFeedbackQuote(previous) && previous.selection?.kind === "time" ? previous : undefined;
  const correction = last && /^(?:(?:我说的|我是说|我要改的|改的|目标|只改|改|是|的是|其实是|不是|不对|而是|，|,|\s)*(?:音乐|背景音乐|画面|视频|旁白|人声))+[。.!！\s]*$/u.test(text.trim());
  const tracks = editTargets(text);
  const spans = explicitSpans(text);
  if (!correction && !tracks.length && !pointAt.test(text) && !spans.length && !/声音|音量|音轨/u.test(text)) return null;
  if (!correction && !locateOnly.test(text) && (
    (!playbackFeedback.test(text) && !((spans.length || pointAt.test(text) || tracks.length) && scopedDirection.test(text))) ||
    /生成|渲染|关键帧|首帧|尾帧|仓库|重做|抽帧|改图|上传|付费|字幕|全片|整轨|整个视频|撤销|如果|比如|怎么|如何|能不能/u.test(text) ||
    looksLikeVideoFeedback(text) || parseDialogueVisualSync(text) ||
    /[“「"][^”」"]+[”」"]/.test(text) && /提前|上屏|慢了/u.test(text) && tracks.includes("visual") ||
    parseSoundChat(text)?.type === "edit" && !snapshot.playing && !snapshot.range && !pointAt.test(text) && !spans.length
  )) return null;
  if (spans.length > 1) return { error: "这句话里有多个时间位置。请先指定其中一处，或说一个连续的时间段。" } as const;
  let span = spans[0] as Span | undefined;
  let shotNo;
  try { shotNo = explicitReferenceShotNumber(text); } catch { return null; }
  const shot = shotNo == null ? null : snapshot.rows.find(row => row.shotNo === shotNo);
  if (shotNo != null && !shot) return { error: "这个镜头没有出现在当前剪辑线上，请核对镜号。" } as const;
  if (shot && span && /镜(?:头)?(?:里|内|中|开始后|的第)/u.test(text) && !/全片|全局/u.test(text))
    span = { startMs: shot.startMs + span.startMs, endMs: shot.startMs + span.endMs };
  const quote = text.match(/[“「"]([^”」"]+)[”」"]/u)?.[1]?.trim().toLowerCase();
  if (!span && quote) {
    const cues = snapshot.cues.filter(cue => cue.text.toLowerCase().includes(quote) && (!shot ||
      cue.startFrame >= shot.startFrame && cue.startFrame < shot.startFrame + shot.durationFrames));
    const matches = new Map(cues.map(cue => [cue.startFrame + "/" + cue.durationFrames, cue]));
    if (matches.size !== 1) return { error: matches.size ? "这句台词出现了几次，请补充秒数或镜号。" : "当前字幕里没有找到这句台词，请补充秒数或选中时间段。" } as const;
    const cue = [...matches.values()][0];
    span = { startMs: Math.round(cue.startFrame * 1000 / TIMELINE_FPS), endMs: Math.round((cue.startFrame + cue.durationFrames) * 1000 / TIMELINE_FPS) };
  }
  if (correction && last?.selection?.kind === "time") {
    if (Number(last.sourceId.slice(prefix.length).split(":")[0]) !== snapshot.version) return { error: "剪辑版本已经更新，请重新指一下反馈的位置。" } as const;
    span = quotedSpan(last) ?? undefined;
  }
  if (!span && !shot && !snapshot.range && /这(?:一)?句(?:旁白|台词|对白)/u.test(text)) {
    const frame = Math.floor(snapshot.positionMs * TIMELINE_FPS / 1000);
    const active = snapshot.cues.filter(cue => cue.startFrame <= frame && frame < cue.startFrame + cue.durationFrames);
    const cue = active[0];
    if (cue && active.every(c => c.startFrame === cue.startFrame && c.durationFrames === cue.durationFrames))
      span = { startMs: Math.round(cue.startFrame * 1000 / TIMELINE_FPS), endMs: Math.round((cue.startFrame + cue.durationFrames) * 1000 / TIMELINE_FPS) };
  }
  span ??= shot ?? snapshot.range ?? { startMs: snapshot.positionMs, endMs: snapshot.positionMs };
  if (span.startMs < 0 || span.endMs < span.startMs || span.endMs > snapshot.totalMs || (shot && (span.startMs < shot.startMs || span.endMs > shot.endMs)))
    return { error: "这个时间超出了当前剪辑范围或前后颠倒，请核对起止时间。" } as const;
  const row = shot ?? storyboardTimingWinnerAt(snapshot.rows, span.startMs, snapshot.hidden);
  const label = spanLabel(span) + " · " + (tracks.map(track => names[track]).join("、") || "待确定修改对象");
  // The shared archive stores non-empty time selections. For a point, quote
  // its containing frame, keeping the exact instant for navigation and replay.
  const point = span.startMs === span.endMs;
  const frameStart = Math.min(Math.floor(span.startMs * TIMELINE_FPS / 1000),
    Math.max(0, Math.ceil(snapshot.totalMs * TIMELINE_FPS / 1000) - 1));
  const selection: SelectionContext = {
    sourceType: "timeline-range", sourceId: [prefix + snapshot.version, tracks.join(","), span.startMs, span.endMs].join(":"),
    storyId: snapshot.storyId, selectedText: label, fullText: label, materialStatus: "timeline-range",
    stableShotId: row?.stableShotId, shotNo: row?.shotNo,
    selection: { kind: "time", startSec: point ? frameStart / TIMELINE_FPS : span.startMs / 1000,
      endSec: point ? Math.min((frameStart + 1) / TIMELINE_FPS, snapshot.totalMs / 1000) : span.endMs / 1000 },
  };
  return { selection, label } as const;
}
export function focusFeedbackQuote(storyId: number, quote: Pick<Quote, "sourceId" | "selection">) {
  const editor = editors.get(storyId);
  const span = quotedSpan(quote);
  if (!editor || !span) return "剪辑线尚未就绪，载入后可点这条时间引用重新定位。";
  const current = editor.read();
  if (current.version !== Number(quote.sourceId.slice(prefix.length).split(":")[0])) return "剪辑版本已变化，请在当前版本重新指定时间。";
  const tracks = quoteTracks(quote);
  const detail = editor.focus(span, tracks);
  const time = spanLabel(span);
  if (!tracks.length) return "已定位到 " + time + "。你想改画面、音乐还是旁白？直接回复名称即可。";
  return "已定位到 " + time + " 的" + tracks.map(t => names[t]).join("、") + "。" + detail;
}
