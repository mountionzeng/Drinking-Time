import { STORY_TIMELINE_FPS } from "./storyMaterial";

export type ExtractedTimelineFrame = {
  id: string;
  imageId: number;
  atMs: number;
};

export type ExtractedFramePair = {
  left: ExtractedTimelineFrame;
  right: ExtractedTimelineFrame;
  startFrame: number;
  endFrame: number;
  intervalMs: number;
  requestedDurationSec: number;
};

export type ExtractedFramePairResult =
  | { kind: "ok"; pair: ExtractedFramePair }
  | { kind: "blocked"; reason: string };

/** Strictly recognizes prompts written by the timeline frame-extraction flow. */
export function extractedFrameTimeMs(
  prompt: string | null | undefined
): number | null {
  if (!prompt) return null;
  const durable = prompt.match(/时间线抽帧\s*·\s*(\d+)ms/);
  if (durable) return Math.max(0, Number(durable[1]));
  const legacy = prompt.match(/时间线\s+(\d+):(\d{2})\.(\d{3})\s+提取帧/);
  if (!legacy) return null;
  return (
    Number(legacy[1]) * 60_000 +
    Number(legacy[2]) * 1_000 +
    Number(legacy[3])
  );
}

export function requestedExtractedFrameVideoDurationSec(intervalMs: number): number {
  if (!Number.isFinite(intervalMs) || intervalMs < 1_000) return 0;
  return Math.min(8, Math.floor(intervalMs / 1_000));
}

export function selectExtractedFramePair(input: {
  frames: readonly ExtractedTimelineFrame[];
  atMs: number;
}): ExtractedFramePairResult {
  if (!Number.isFinite(input.atMs) || input.atMs < 0) {
    return { kind: "blocked", reason: "点击位置无效" };
  }
  const frames = [...input.frames]
    .filter(
      frame =>
        Number.isInteger(frame.imageId) &&
        frame.imageId > 0 &&
        Number.isFinite(frame.atMs) &&
        frame.atMs >= 0
    )
    .sort((left, right) => left.atMs - right.atMs || left.id.localeCompare(right.id));
  const left = [...frames].reverse().find(frame => frame.atMs < input.atMs);
  const right = frames.find(frame => frame.atMs > input.atMs);
  if (!left || !right) {
    return { kind: "blocked", reason: "点击位置两侧都需要一张抽帧" };
  }
  const intervalMs = right.atMs - left.atMs;
  const requestedDurationSec = requestedExtractedFrameVideoDurationSec(intervalMs);
  if (requestedDurationSec < 1) {
    return { kind: "blocked", reason: "两张抽帧至少需要间隔 1 秒" };
  }
  return {
    kind: "ok",
    pair: {
      left,
      right,
      startFrame: Math.round((left.atMs * STORY_TIMELINE_FPS) / 1_000),
      endFrame: Math.round((right.atMs * STORY_TIMELINE_FPS) / 1_000),
      intervalMs,
      requestedDurationSec,
    },
  };
}
