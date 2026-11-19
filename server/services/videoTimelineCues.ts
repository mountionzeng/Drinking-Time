import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildTimelineLayout } from "../../shared/timelineLayout";
import { normalizeSubtitleState } from "../../shared/timelineSubtitleModel";
import {
  audioMixInputGainAtFrame,
  audioMixInputSourceFrameAt,
  buildAudioMixPlan,
  normalizeAudioState,
  type AudioMixPlanInput,
} from "../../shared/timelineAudioModel";
import type { StoryTimelineItem } from "../../shared/storyMaterial";
import { getStoryTimeline } from "../repositories/timelines";
import { listStoryAudioAssetRows } from "../repositories/audioAssets";
import { resolveManagedAudioPath } from "./audioMedia";

const run = promisify(execFile);
const seconds = (frame: number) => Number((frame / 30).toFixed(2));
type Window = { start: number; end: number };
type TimedText = { from: number; to: number; text: string };
type AudioCue = {
  from: number;
  to: number;
  kind: string;
  assetId: number;
  name: string;
  sourceIn: number;
  sourceOut: number;
  gain: number;
  fadeIn: number;
  fadeOut: number;
  accents: number[];
  dynamics?: string;
};
export type VideoTimelineCue = {
  startFrame: number;
  endFrame: number;
  text: TimedText[];
  audio: AudioCue[];
};

function overlap(start: number, end: number, window: Window) {
  const a = Math.max(start, window.start),
    b = Math.min(end, window.end);
  return a < b
    ? { a, b, from: seconds(a - window.start), to: seconds(b - window.start) }
    : null;
}

/** Strong local rises in RMS energy, measured on decoded samples with the timeline gain envelope. */
export function musicAccents(
  pcm: Buffer,
  clip: AudioMixPlanInput,
  start: number
) {
  const bins: number[] = [];
  const samplesPerBin = 400; // 0.1s at 4kHz, mono 16-bit PCM
  for (
    let offset = 0;
    offset + samplesPerBin * 2 <= pcm.length;
    offset += samplesPerBin * 2
  ) {
    let sum = 0;
    for (let i = 0; i < samplesPerBin; i++)
      sum += (pcm.readInt16LE(offset + i * 2) / 32768) ** 2;
    bins.push(
      Math.sqrt(sum / samplesPerBin) *
        audioMixInputGainAtFrame(clip, start + bins.length * 3)
    );
  }
  const rises = bins.map((v, i) => ({
    frame: i * 3,
    delta: i ? v - bins[i - 1] : 0,
  }));
  const selected: number[] = [];
  for (const r of rises.sort((a, b) => b.delta - a.delta)) {
    if (r.delta < 0.015 || selected.length === 3) break;
    if (selected.every(frame => Math.abs(frame - r.frame) >= 9))
      selected.push(r.frame);
  }
  const block = Math.max(1, Math.floor(bins.length / 3));
  const mean = (levels: number[]) =>
    levels.reduce((sum, l) => sum + l, 0) / Math.max(1, levels.length);
  const shift =
    20 *
    Math.log10(
      (mean(bins.slice(-block)) + 0.0001) /
        (mean(bins.slice(0, block)) + 0.0001)
    );
  const dynamics =
    mean(bins) < 0.001
      ? "近静音"
      : shift > 3
        ? "渐强"
        : shift < -3
          ? "渐弱"
          : "响度平稳";
  return { peaks: selected.sort((a, b) => a - b), dynamics };
}
async function readMusic(
  assetKey: string,
  clip: AudioMixPlanInput,
  start: number,
  end: number
) {
  const { stdout } = await run(
    process.env.FFMPEG_PATH ?? "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      "-ss",
      String(audioMixInputSourceFrameAt(clip, start) / 30),
      "-i",
      resolveManagedAudioPath(assetKey),
      "-t",
      String((end - start) / 30),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "4000",
      "-f",
      "s16le",
      "pipe:1",
    ],
    { encoding: "buffer", timeout: 10000, maxBuffer: 1024 * 1024 }
  );
  return musicAccents(stdout, clip, start);
}

export async function readVideoTimelineCues(
  storyId: number,
  userId: number,
  shotId: string,
  durations: number[]
): Promise<(VideoTimelineCue | null)[]> {
  const timeline = await getStoryTimeline(storyId, userId);
  const items: StoryTimelineItem[] = Array.isArray(timeline?.items)
    ? timeline.items
    : [];
  const row = buildTimelineLayout(items.filter(item => item.included)).find(
    r => r.item.stableShotId === shotId
  );
  if (!row) return durations.map(() => null);
  const subtitles = normalizeSubtitleState(
    timeline?.extensions?.subtitleTracks
  ).tracks.flatMap(t => t.cues);
  const audio = buildAudioMixPlan({
    audioState: normalizeAudioState(timeline?.extensions?.audioTracks),
  }).inputs;
  const assets = audio.length
    ? await listStoryAudioAssetRows({ storyId, userId })
    : [];
  let cursor = row.startFrame;
  const cues: (VideoTimelineCue | null)[] = [];
  for (const duration of durations) {
    const window = {
      start: cursor,
      end: Math.min(row.endFrame, cursor + Math.round(duration * 30)),
    };
    cursor += Math.round(duration * 30);
    const text: TimedText[] = [],
      sounds: AudioCue[] = [];
    for (const cue of subtitles) {
      const point = overlap(
        cue.startFrame,
        cue.startFrame + cue.durationFrames,
        window
      );
      if (point && cue.text.trim())
        text.push({
          from: point.from,
          to: point.to,
          text: cue.text.trim().replace(/\s+/g, " "),
        });
    }
    for (const clip of audio) {
      if (clip.muted || clip.baseGain <= 0 || clip.source.kind !== "asset")
        continue;
      const point = overlap(
        clip.timelineStartFrame,
        clip.timelineStartFrame + clip.durationFrames,
        window
      );
      if (!point) continue;
      const assetId = clip.source.assetId,
        asset = assets.find(a => a.id === assetId && a.status === "ready");
      if (!asset) continue;
      const { a, b, from, to } = point;
      const music =
        clip.kind === "music"
          ? await readMusic(asset.storageKey, clip, a, b)
          : undefined;
      sounds.push({
        kind: clip.kind,
        assetId,
        name: asset.displayName,
        from,
        to,
        sourceIn: audioMixInputSourceFrameAt(clip, a),
        sourceOut: audioMixInputSourceFrameAt(clip, b - 1) + 1,
        gain: clip.baseGain,
        fadeIn: clip.fadeInFrames,
        fadeOut: clip.fadeOutFrames,
        accents: music?.peaks.map(f => seconds(a - window.start + f)) ?? [],
        dynamics: music?.dynamics,
      });
    }
    cues.push(
      text.length || sounds.length
        ? {
            startFrame: window.start,
            endFrame: window.end,
            text,
            audio: sounds,
          }
        : null
    );
  }
  return cues;
}

export function directionFromTimeline(
  cue: VideoTimelineCue | null,
  compact = false
) {
  if (!cue) return "";
  if (compact) {
    const caption =
      cue.text.find(c => /[\u3400-\u9fff]/.test(c.text)) ?? cue.text[0];
    const accents = cue.audio
      .filter(a => a.kind === "music")
      .flatMap(a => a.accents)
      .slice(0, 3);
    return [
      "动作配合同期语意与乐句。",
      caption &&
        `${caption.from}–${caption.to}s「${caption.text.slice(0, 24)}」`,
      accents.length && "重音 " + accents.join("/") + "s",
      "勿绘字幕。",
    ]
      .filter(Boolean)
      .join(" ");
  }
  const lines = cue.text.map(
    c => c.from + "–" + c.to + "秒 " + JSON.stringify(c.text)
  );
  const roles: Record<string, string> = {
    music: "配乐",
    narration: "旁白",
    dialogue: "对白",
    ambience: "环境音",
    sfx: "音效",
    source: "原声",
  };
  for (const a of cue.audio)
    lines.push(
      a.from +
        "–" +
        a.to +
        "秒 " +
        (roles[a.kind] ?? a.kind) +
        (a.dynamics ? " " + a.dynamics : "") +
        (a.accents.length ? "，音量重音 " + a.accents.join("/") + "秒" : "")
    );
  return (
    "同期剪辑参考（片段内秒数）：按语句含义与停顿安排已有主体的动作，在配乐重音附近落下动作或转折。字幕仅供理解，不烧录，沿用已有配乐，不添加画面元素。\n" +
    lines.join("\n")
  );
}
