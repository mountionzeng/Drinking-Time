/**
 * The one authoritative model for the five fixed audio tracks and their pure
 * edit planner (U9).
 *
 * Tracks are a fixed set in a fixed order — `narration`, `music`, `ambience`,
 * `sfx`, `source`. There is no solo, no loop, no arbitrary track manager. Track
 * order is for reading only; it never decides mixing.
 *
 * A clip holds a non-owning `assetId` (a `ready` StoryAudioAsset from U2) plus
 * its own timeline placement, source crop and mix params. There is no speed in
 * v1, so `durationFrames === sourceOutFrame - sourceInFrame` is a hard
 * invariant: move only changes `timelineStartFrame`; a left trim raises
 * `sourceInFrame` and shortens duration; a right trim lowers `sourceOutFrame`
 * and shortens duration.
 *
 * Everything here is pure — domain objects and 30fps integer frames only. No
 * pixels, no milliseconds, no asset lookups, no TTS.
 */

export const AUDIO_TRACK_KINDS = [
  "narration",
  "music",
  "ambience",
  "sfx",
  "source",
] as const;
export type AudioTrackKind = (typeof AUDIO_TRACK_KINDS)[number];

export const MIN_AUDIO_CLIP_FRAMES = 1;
export const MAX_AUDIO_GAIN = 4;

export type AudioClip = {
  id: string;
  /** A `ready` StoryAudioAsset id. Non-owning. */
  assetId: number;
  /** Absolute 30fps start on the timeline. */
  timelineStartFrame: number;
  /** Source crop, in frames of the asset's real media. */
  sourceInFrame: number;
  sourceOutFrame: number;
  /** Always `sourceOutFrame - sourceInFrame` (no speed in v1). */
  durationFrames: number;
  /** Linear gain multiplier, 0..MAX_AUDIO_GAIN. 1 = unity. */
  gain: number;
  muted: boolean;
  fadeInFrames: number;
  fadeOutFrames: number;
  /** Set on a narration clip bound to a subtitle cue (U9 binding). */
  speechBindingId?: string;
  /** True once the bound subtitle's text changed and this narration is out of date. */
  textStale?: boolean;
  /**
   * A `source` clip that stands in for one specific video's embedded audio.
   * Only an explicit linked identity suppresses the duplicate visual original.
   */
  linkedVisualSourceId?: string;
};

export type AudioTrack = {
  kind: AudioTrackKind;
  muted: boolean;
  /** Track-level default gain, multiplied with clip gain. */
  defaultGain: number;
  clips: AudioClip[];
};

export type TimelineAudioState = {
  tracks: AudioTrack[];
};

export type AudioPlannerOk = {
  status: "ok";
  state: TimelineAudioState;
  changed: boolean;
};
export type AudioPlannerError = { status: "error"; message: string };
export type AudioPlannerResult = AudioPlannerOk | AudioPlannerError;

const ok = (state: TimelineAudioState, changed: boolean): AudioPlannerOk => ({
  status: "ok",
  state,
  changed,
});
const err = (message: string): AudioPlannerError => ({
  status: "error",
  message,
});

const isInt = (value: number) => Number.isInteger(value);

export function emptyAudioState(): TimelineAudioState {
  return {
    tracks: AUDIO_TRACK_KINDS.map(kind => ({
      kind,
      muted: false,
      defaultGain: 1,
      clips: [],
    })),
  };
}

function clampGain(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_AUDIO_GAIN, Math.max(0, value));
}

function normalizeClip(raw: unknown): AudioClip | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.assetId !== "number" ||
    typeof record.timelineStartFrame !== "number" ||
    typeof record.sourceInFrame !== "number" ||
    typeof record.sourceOutFrame !== "number"
  ) {
    return null;
  }
  const sourceInFrame = Math.max(0, Math.round(record.sourceInFrame));
  const sourceOutFrame = Math.max(
    sourceInFrame + MIN_AUDIO_CLIP_FRAMES,
    Math.round(record.sourceOutFrame)
  );
  return {
    id: record.id,
    assetId: record.assetId,
    timelineStartFrame: Math.max(0, Math.round(record.timelineStartFrame)),
    sourceInFrame,
    sourceOutFrame,
    durationFrames: sourceOutFrame - sourceInFrame,
    gain: typeof record.gain === "number" ? clampGain(record.gain) : 1,
    muted: record.muted === true,
    fadeInFrames:
      typeof record.fadeInFrames === "number"
        ? Math.max(0, Math.round(record.fadeInFrames))
        : 0,
    fadeOutFrames:
      typeof record.fadeOutFrames === "number"
        ? Math.max(0, Math.round(record.fadeOutFrames))
        : 0,
    ...(typeof record.speechBindingId === "string"
      ? { speechBindingId: record.speechBindingId }
      : {}),
    ...(record.textStale === true ? { textStale: true } : {}),
    ...(typeof record.linkedVisualSourceId === "string"
      ? { linkedVisualSourceId: record.linkedVisualSourceId }
      : {}),
  };
}

/** Coerce an unknown stored value into a well-formed 5-track state. */
export function normalizeAudioState(value: unknown): TimelineAudioState {
  const base = emptyAudioState();
  if (!value || typeof value !== "object") return base;
  const rawTracks = Array.isArray((value as { tracks?: unknown }).tracks)
    ? ((value as { tracks: unknown[] }).tracks as unknown[])
    : Array.isArray(value)
      ? (value as unknown[])
      : [];
  const byKind = new Map<AudioTrackKind, AudioTrack>(
    base.tracks.map(track => [track.kind, track])
  );
  for (const rawTrack of rawTracks) {
    if (!rawTrack || typeof rawTrack !== "object") continue;
    const record = rawTrack as Record<string, unknown>;
    const kind = record.kind as AudioTrackKind;
    const track = byKind.get(kind);
    if (!track) continue;
    track.muted = record.muted === true;
    track.defaultGain =
      typeof record.defaultGain === "number"
        ? clampGain(record.defaultGain)
        : 1;
    const rawClips = Array.isArray(record.clips) ? record.clips : [];
    track.clips = rawClips
      .map(normalizeClip)
      .filter((clip): clip is AudioClip => clip !== null)
      .sort((a, b) => a.timelineStartFrame - b.timelineStartFrame);
  }
  return { tracks: AUDIO_TRACK_KINDS.map(kind => byKind.get(kind)!) };
}

function track(
  state: TimelineAudioState,
  kind: AudioTrackKind
): AudioTrack | undefined {
  return state.tracks.find(t => t.kind === kind);
}

function findClip(
  state: TimelineAudioState,
  clipId: string
): { track: AudioTrack; clip: AudioClip } | null {
  for (const t of state.tracks) {
    const clip = t.clips.find(c => c.id === clipId);
    if (clip) return { track: t, clip };
  }
  return null;
}

function withUpdatedClip(
  state: TimelineAudioState,
  clipId: string,
  update: (clip: AudioClip) => AudioClip
): TimelineAudioState {
  return {
    tracks: state.tracks.map(t => ({
      ...t,
      clips: t.clips
        .map(c => (c.id === clipId ? update(c) : c))
        .sort((a, b) => a.timelineStartFrame - b.timelineStartFrame),
    })),
  };
}

export function audioClipEndFrame(clip: AudioClip): number {
  return clip.timelineStartFrame + clip.durationFrames;
}

// ── Planner operations ───────────────────────────────────────────────────

export type InsertAudioClipInput = {
  id: string;
  kind: AudioTrackKind;
  assetId: number;
  timelineStartFrame: number;
  /** Defaults to [0, assetDurationFrames]. */
  sourceInFrame?: number;
  sourceOutFrame: number;
  gain?: number;
  linkedVisualSourceId?: string;
  speechBindingId?: string;
};

export function insertAudioClip(
  state: TimelineAudioState,
  input: InsertAudioClipInput
): AudioPlannerResult {
  const target = track(state, input.kind);
  if (!target) return err("音轨类型非法");
  if (findClip(state, input.id)) return err("音频片段 ID 已存在");
  const sourceInFrame = Math.max(0, Math.round(input.sourceInFrame ?? 0));
  const sourceOutFrame = Math.round(input.sourceOutFrame);
  if (
    !isInt(sourceInFrame) ||
    !isInt(sourceOutFrame) ||
    sourceOutFrame - sourceInFrame < MIN_AUDIO_CLIP_FRAMES
  ) {
    return err("音频源区间至少一帧");
  }
  if (!isInt(input.timelineStartFrame) || input.timelineStartFrame < 0) {
    return err("音频起点必须是非负整数帧");
  }
  const clip: AudioClip = {
    id: input.id,
    assetId: input.assetId,
    timelineStartFrame: input.timelineStartFrame,
    sourceInFrame,
    sourceOutFrame,
    durationFrames: sourceOutFrame - sourceInFrame,
    gain: input.gain === undefined ? 1 : clampGain(input.gain),
    muted: false,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    ...(input.linkedVisualSourceId
      ? { linkedVisualSourceId: input.linkedVisualSourceId }
      : {}),
    ...(input.speechBindingId
      ? { speechBindingId: input.speechBindingId }
      : {}),
  };
  return ok(
    {
      tracks: state.tracks.map(t =>
        t.kind === input.kind
          ? {
              ...t,
              clips: [...t.clips, clip].sort(
                (a, b) => a.timelineStartFrame - b.timelineStartFrame
              ),
            }
          : t
      ),
    },
    true
  );
}

export function moveAudioClip(
  state: TimelineAudioState,
  input: { clipId: string; toStartFrame: number }
): AudioPlannerResult {
  const found = findClip(state, input.clipId);
  if (!found) return err("音频片段不存在");
  if (!isInt(input.toStartFrame) || input.toStartFrame < 0) {
    return err("音频起点必须是非负整数帧");
  }
  if (input.toStartFrame === found.clip.timelineStartFrame) {
    return ok(state, false);
  }
  return ok(
    withUpdatedClip(state, input.clipId, clip => ({
      ...clip,
      timelineStartFrame: input.toStartFrame,
    })),
    true
  );
}

/** Left trim: raise sourceIn, shorten duration, keep the timeline tail fixed. */
export function trimAudioClipStart(
  state: TimelineAudioState,
  input: { clipId: string; deltaFrames: number }
): AudioPlannerResult {
  const found = findClip(state, input.clipId);
  if (!found) return err("音频片段不存在");
  const { clip } = found;
  const nextSourceIn = clip.sourceInFrame + input.deltaFrames;
  if (!isInt(nextSourceIn) || nextSourceIn < 0) {
    return err("裁剪越过素材开头");
  }
  if (clip.sourceOutFrame - nextSourceIn < MIN_AUDIO_CLIP_FRAMES) {
    return err("音频至少保留一帧");
  }
  if (input.deltaFrames === 0) return ok(state, false);
  return ok(
    withUpdatedClip(state, input.clipId, current => ({
      ...current,
      sourceInFrame: nextSourceIn,
      durationFrames: current.sourceOutFrame - nextSourceIn,
      timelineStartFrame: current.timelineStartFrame + input.deltaFrames,
    })),
    true
  );
}

/** Right trim: lower sourceOut, shorten duration, keep the timeline head fixed. */
export function trimAudioClipEnd(
  state: TimelineAudioState,
  input: { clipId: string; deltaFrames: number }
): AudioPlannerResult {
  const found = findClip(state, input.clipId);
  if (!found) return err("音频片段不存在");
  const { clip } = found;
  const nextSourceOut = clip.sourceOutFrame + input.deltaFrames;
  if (!isInt(nextSourceOut)) return err("裁剪帧必须是整数");
  if (nextSourceOut - clip.sourceInFrame < MIN_AUDIO_CLIP_FRAMES) {
    return err("音频至少保留一帧");
  }
  if (input.deltaFrames === 0) return ok(state, false);
  return ok(
    withUpdatedClip(state, input.clipId, current => ({
      ...current,
      sourceOutFrame: nextSourceOut,
      durationFrames: nextSourceOut - current.sourceInFrame,
    })),
    true
  );
}

export function deleteAudioClip(
  state: TimelineAudioState,
  input: { clipId: string }
): AudioPlannerResult {
  if (!findClip(state, input.clipId)) return ok(state, false);
  return ok(
    {
      tracks: state.tracks.map(t => ({
        ...t,
        clips: t.clips.filter(c => c.id !== input.clipId),
      })),
    },
    true
  );
}

/** Move a clip to another semantic track. Same clip object, no asset copy. */
export function reclassifyAudioClip(
  state: TimelineAudioState,
  input: { clipId: string; toKind: AudioTrackKind }
): AudioPlannerResult {
  const found = findClip(state, input.clipId);
  if (!found) return err("音频片段不存在");
  if (!track(state, input.toKind)) return err("音轨类型非法");
  if (found.track.kind === input.toKind) return ok(state, false);
  if (found.clip.speechBindingId && input.toKind !== "narration") {
    return err("解除字幕绑定后才能改变旁白类型");
  }
  const moving = found.clip;
  return ok(
    {
      tracks: state.tracks.map(t => {
        if (t.kind === found.track.kind) {
          return { ...t, clips: t.clips.filter(c => c.id !== moving.id) };
        }
        if (t.kind === input.toKind) {
          return {
            ...t,
            clips: [...t.clips, moving].sort(
              (a, b) => a.timelineStartFrame - b.timelineStartFrame
            ),
          };
        }
        return t;
      }),
    },
    true
  );
}

export function setAudioClipGain(
  state: TimelineAudioState,
  input: { clipId: string; gain: number }
): AudioPlannerResult {
  const found = findClip(state, input.clipId);
  if (!found) return err("音频片段不存在");
  const gain = clampGain(input.gain);
  if (gain === found.clip.gain) return ok(state, false);
  return ok(
    withUpdatedClip(state, input.clipId, clip => ({ ...clip, gain })),
    true
  );
}

export function setAudioClipMuted(
  state: TimelineAudioState,
  input: { clipId: string; muted: boolean }
): AudioPlannerResult {
  const found = findClip(state, input.clipId);
  if (!found) return err("音频片段不存在");
  if (found.clip.muted === input.muted) return ok(state, false);
  return ok(
    withUpdatedClip(state, input.clipId, clip => ({
      ...clip,
      muted: input.muted,
    })),
    true
  );
}

export function setAudioClipFade(
  state: TimelineAudioState,
  input: { clipId: string; fadeInFrames?: number; fadeOutFrames?: number }
): AudioPlannerResult {
  const found = findClip(state, input.clipId);
  if (!found) return err("音频片段不存在");
  const fadeInFrames =
    input.fadeInFrames === undefined
      ? found.clip.fadeInFrames
      : Math.max(0, Math.round(input.fadeInFrames));
  const fadeOutFrames =
    input.fadeOutFrames === undefined
      ? found.clip.fadeOutFrames
      : Math.max(0, Math.round(input.fadeOutFrames));
  if (
    fadeInFrames === found.clip.fadeInFrames &&
    fadeOutFrames === found.clip.fadeOutFrames
  ) {
    return ok(state, false);
  }
  return ok(
    withUpdatedClip(state, input.clipId, clip => ({
      ...clip,
      fadeInFrames,
      fadeOutFrames,
    })),
    true
  );
}

export function setAudioTrackMuted(
  state: TimelineAudioState,
  input: { kind: AudioTrackKind; muted: boolean }
): AudioPlannerResult {
  const target = track(state, input.kind);
  if (!target) return err("音轨类型非法");
  if (target.muted === input.muted) return ok(state, false);
  return ok(
    {
      tracks: state.tracks.map(t =>
        t.kind === input.kind ? { ...t, muted: input.muted } : t
      ),
    },
    true
  );
}

export function setAudioTrackGain(
  state: TimelineAudioState,
  input: { kind: AudioTrackKind; gain: number }
): AudioPlannerResult {
  const target = track(state, input.kind);
  if (!target) return err("音轨类型非法");
  const gain = clampGain(input.gain);
  if (gain === target.defaultGain) return ok(state, false);
  return ok(
    {
      tracks: state.tracks.map(t =>
        t.kind === input.kind ? { ...t, defaultGain: gain } : t
      ),
    },
    true
  );
}

// ── Resolve / duration ───────────────────────────────────────────────────

export type ActiveAudioClip = {
  kind: AudioTrackKind;
  clip: AudioClip;
  trackMuted: boolean;
  trackDefaultGain: number;
};

/** Every clip overlapping `frame`, muted or not, in fixed track order. */
export function resolveAudioClipsAtFrame(
  state: TimelineAudioState,
  frame: number
): ActiveAudioClip[] {
  const active: ActiveAudioClip[] = [];
  for (const t of state.tracks) {
    for (const clip of t.clips) {
      if (frame >= clip.timelineStartFrame && frame < audioClipEndFrame(clip)) {
        active.push({
          kind: t.kind,
          clip,
          trackMuted: t.muted,
          trackDefaultGain: t.defaultGain,
        });
      }
    }
  }
  return active;
}

export function audioStateEndFrame(state: TimelineAudioState): number {
  let max = 0;
  for (const t of state.tracks) {
    for (const clip of t.clips) {
      max = Math.max(max, audioClipEndFrame(clip));
    }
  }
  return max;
}

/** True iff every clip keeps the no-speed invariant. */
export function audioStateSpeedInvariantHolds(
  state: TimelineAudioState
): boolean {
  return state.tracks.every(t =>
    t.clips.every(
      clip => clip.durationFrames === clip.sourceOutFrame - clip.sourceInFrame
    )
  );
}

// ── Shared preview / export plan ─────────────────────────────────────────

/**
 * A video's embedded audio projected into timeline coordinates by the visual
 * adapter. `checksum` is diagnostic metadata only: it must never cause
 * implicit de-duplication. Only `AudioClip.linkedVisualSourceId` may replace
 * one of these inputs.
 */
export type TimelineVisualAudioSource = {
  id: string;
  timelineStartFrame: number;
  sourceInFrame: number;
  sourceOutFrame: number;
  durationFrames: number;
  gain: number;
  muted: boolean;
  checksum?: string;
  playbackRate?: number;
  reverse?: boolean;
};

export type AudioMixPlanSource =
  | { kind: "asset"; assetId: number }
  | { kind: "visual-source"; visualSourceId: string };

export type AudioMixPlanInput = {
  /** Stable within one plan. Visual sources use the `visual:` namespace. */
  id: string;
  kind: AudioTrackKind | "visual-source";
  source: AudioMixPlanSource;
  timelineStartFrame: number;
  sourceInFrame: number;
  sourceOutFrame: number;
  durationFrames: number;
  /** Track gain × clip gain, before mute and fades. */
  baseGain: number;
  muted: boolean;
  fadeInFrames: number;
  fadeOutFrames: number;
  playbackRate: number;
  reverse: boolean;
  linkedVisualSourceId?: string;
};

export type AudioMixPlan = {
  inputs: AudioMixPlanInput[];
  suppressedVisualSourceIds: string[];
  endFrame: number;
};

function normalizedPlanRate(value: number | undefined): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return 1;
  return Math.min(4, Math.max(0.25, value!));
}

function normalizeVisualAudioSource(
  source: TimelineVisualAudioSource
): TimelineVisualAudioSource | null {
  if (!source.id) return null;
  const timelineStartFrame = Math.max(0, Math.round(source.timelineStartFrame));
  const sourceInFrame = Math.max(0, Math.round(source.sourceInFrame));
  const sourceOutFrame = Math.max(
    sourceInFrame + 1,
    Math.round(source.sourceOutFrame)
  );
  const durationFrames = Math.max(1, Math.round(source.durationFrames));
  return {
    ...source,
    timelineStartFrame,
    sourceInFrame,
    sourceOutFrame,
    durationFrames,
    gain: clampGain(source.gain),
    muted: source.muted === true,
    playbackRate: normalizedPlanRate(source.playbackRate),
    reverse: source.reverse === true,
  };
}

/** Build the only semantic audio plan used by realtime and export executors. */
export function buildAudioMixPlan(input: {
  audioState: TimelineAudioState;
  visualSources?: readonly TimelineVisualAudioSource[];
}): AudioMixPlan {
  const audioState = normalizeAudioState(input.audioState);
  const linkedVisualSourceIds = new Set<string>();
  for (const audioTrack of audioState.tracks) {
    if (audioTrack.kind !== "source") continue;
    for (const clip of audioTrack.clips) {
      if (clip.linkedVisualSourceId) {
        linkedVisualSourceIds.add(clip.linkedVisualSourceId);
      }
    }
  }

  const suppressedVisualSourceIds = [...linkedVisualSourceIds].sort();
  const visualInputs = (input.visualSources ?? [])
    .map(normalizeVisualAudioSource)
    .filter((source): source is TimelineVisualAudioSource => source !== null)
    .filter(source => !linkedVisualSourceIds.has(source.id))
    .sort(
      (left, right) =>
        left.timelineStartFrame - right.timelineStartFrame ||
        left.id.localeCompare(right.id)
    )
    .map<AudioMixPlanInput>(source => ({
      id: `visual:${source.id}`,
      kind: "visual-source",
      source: { kind: "visual-source", visualSourceId: source.id },
      timelineStartFrame: source.timelineStartFrame,
      sourceInFrame: source.sourceInFrame,
      sourceOutFrame: source.sourceOutFrame,
      durationFrames: source.durationFrames,
      baseGain: source.gain,
      muted: source.muted,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      playbackRate: normalizedPlanRate(source.playbackRate),
      reverse: source.reverse === true,
    }));

  const formalInputs: AudioMixPlanInput[] = [];
  for (const audioTrack of audioState.tracks) {
    for (const clip of audioTrack.clips) {
      formalInputs.push({
        id: clip.id,
        kind: audioTrack.kind,
        source: { kind: "asset", assetId: clip.assetId },
        timelineStartFrame: clip.timelineStartFrame,
        sourceInFrame: clip.sourceInFrame,
        sourceOutFrame: clip.sourceOutFrame,
        durationFrames: clip.durationFrames,
        baseGain: clampGain(audioTrack.defaultGain * clip.gain),
        muted: audioTrack.muted || clip.muted,
        fadeInFrames: Math.min(clip.durationFrames, clip.fadeInFrames),
        fadeOutFrames: Math.min(clip.durationFrames, clip.fadeOutFrames),
        playbackRate: 1,
        reverse: false,
        ...(clip.linkedVisualSourceId
          ? { linkedVisualSourceId: clip.linkedVisualSourceId }
          : {}),
      });
    }
  }
  const inputs = [...visualInputs, ...formalInputs];
  return {
    inputs,
    suppressedVisualSourceIds,
    endFrame: inputs.reduce(
      (maximum, planned) =>
        Math.max(maximum, planned.timelineStartFrame + planned.durationFrames),
      0
    ),
  };
}

export function resolveAudioMixPlanAtFrame(
  plan: AudioMixPlan,
  frame: number
): AudioMixPlanInput[] {
  const normalizedFrame = Math.max(0, Math.round(frame));
  return plan.inputs.filter(
    input =>
      normalizedFrame >= input.timelineStartFrame &&
      normalizedFrame < input.timelineStartFrame + input.durationFrames
  );
}

/** Deterministic linear gain envelope at one canonical timeline frame. */
export function audioMixInputGainAtFrame(
  input: AudioMixPlanInput,
  frame: number
): number {
  const normalizedFrame = Math.max(0, Math.round(frame));
  const localFrame = normalizedFrame - input.timelineStartFrame;
  if (localFrame < 0 || localFrame >= input.durationFrames || input.muted) {
    return 0;
  }
  const fadeIn =
    input.fadeInFrames > 0 ? Math.min(1, localFrame / input.fadeInFrames) : 1;
  const framesUntilEnd = input.durationFrames - localFrame;
  const fadeOut =
    input.fadeOutFrames > 0
      ? Math.min(1, framesUntilEnd / input.fadeOutFrames)
      : 1;
  return input.baseGain * Math.min(fadeIn, fadeOut);
}

/** Source position (30fps frame) corresponding to a timeline frame. */
export function audioMixInputSourceFrameAt(
  input: AudioMixPlanInput,
  frame: number
): number {
  const localFrame = Math.max(
    0,
    Math.min(input.durationFrames, Math.round(frame) - input.timelineStartFrame)
  );
  const sourceDelta = localFrame * input.playbackRate;
  return input.reverse
    ? Math.max(input.sourceInFrame, input.sourceOutFrame - sourceDelta)
    : Math.min(input.sourceOutFrame, input.sourceInFrame + sourceDelta);
}
