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

export type ExtractedFrameCandidate = {
  frame: ExtractedTimelineFrame;
  side: "left" | "right";
  pair: ExtractedFramePair;
};

export type ExtractedFrameCandidateResult =
  | { kind: "ok"; candidate: ExtractedTimelineFrame; pair: ExtractedFramePair }
  | { kind: "blocked"; reason: string };

function validExtractedFrames(
  frames: readonly ExtractedTimelineFrame[]
): ExtractedTimelineFrame[] {
  return [...frames]
    .filter(
      frame =>
        Number.isInteger(frame.imageId) &&
        frame.imageId > 0 &&
        Number.isFinite(frame.atMs) &&
        frame.atMs >= 0
    )
    .sort((left, right) => left.atMs - right.atMs || left.id.localeCompare(right.id));
}

/**
 * Finds the single nearest usable frame to a selected starting frame.
 * The returned pair is always normalized chronologically, so callers do not
 * need separate rules for selecting a frame to the left or right.
 */
export function selectExtractedFrameCandidate(input: {
  frames: readonly ExtractedTimelineFrame[];
  start: ExtractedTimelineFrame;
  atMs: number;
}): ExtractedFrameCandidateResult {
  if (!Number.isFinite(input.atMs) || input.atMs < 0) {
    return { kind: "blocked", reason: "点击位置无效" };
  }
  const frames = validExtractedFrames(input.frames);
  const start = frames.find(frame => frame.id === input.start.id && frame.imageId === input.start.imageId);
  if (!start) return { kind: "blocked", reason: "起始抽帧已失效" };
  const candidates = frames
    .filter(frame => frame.id !== start.id && frame.atMs !== start.atMs)
    .map(candidate => ({ candidate, distance: Math.abs(candidate.atMs - input.atMs) }))
    .sort((left, right) => left.distance - right.distance || left.candidate.atMs - right.candidate.atMs);
  for (const { candidate } of candidates) {
    const left = candidate.atMs < start.atMs ? candidate : start;
    const right = candidate.atMs > start.atMs ? candidate : start;
    const intervalMs = right.atMs - left.atMs;
    const requestedDurationSec = requestedExtractedFrameVideoDurationSec(intervalMs);
    if (requestedDurationSec < 1) continue;
    const pair: ExtractedFramePair = {
      left,
      right,
      startFrame: Math.round((left.atMs * STORY_TIMELINE_FPS) / 1_000),
      endFrame: Math.round((right.atMs * STORY_TIMELINE_FPS) / 1_000),
      intervalMs,
      requestedDurationSec,
    };
    return { kind: "ok", candidate, pair };
  }
  return { kind: "blocked", reason: "起始抽帧附近没有间隔至少 1 秒的抽帧" };
}

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
  const frames = validExtractedFrames(input.frames);
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

/**
 * Returns the nearest valid candidate on each side of a clicked frame.
 * The caller may choose either candidate; pair ordering is always chronological.
 */
export function selectExtractedFrameCandidates(input: {
  frames: readonly ExtractedTimelineFrame[];
  start: ExtractedTimelineFrame;
}): ExtractedFrameCandidate[] {
  const frames = [...input.frames]
    .filter(
      frame =>
        Number.isInteger(frame.imageId) &&
        frame.imageId > 0 &&
        Number.isFinite(frame.atMs) &&
        frame.atMs >= 0 &&
        frame.imageId !== input.start.imageId
    )
    .sort((left, right) => left.atMs - right.atMs || left.id.localeCompare(right.id));
  const candidates: ExtractedFrameCandidate[] = [];
  for (const side of ["left", "right"] as const) {
    const nearby = frames
      .filter(frame => (side === "left" ? frame.atMs < input.start.atMs : frame.atMs > input.start.atMs))
      .sort((left, right) =>
        Math.abs(left.atMs - input.start.atMs) - Math.abs(right.atMs - input.start.atMs) ||
        left.id.localeCompare(right.id)
      )[0];
    if (!nearby) continue;
    const pairResult = selectExtractedFramePair({
      frames: [input.start, nearby],
      atMs: Math.min(input.start.atMs, nearby.atMs) + 0.5,
    });
    if (pairResult.kind !== "ok") continue;
    candidates.push({ frame: nearby, side, pair: pairResult.pair });
  }
  return candidates;
}
