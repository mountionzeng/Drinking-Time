/**
 * The one authoritative model for the formal subtitle track and its pure edit
 * planner (U3).
 *
 * A subtitle cue owns its final display text and timing. Story `dialogue` and
 * ChatCut `scriptCues` only ever produce the *initial* candidates fed to
 * {@link initializeSubtitleCues}; once a track exists, refreshing the page,
 * changing the Story body, re-attaching ChatCut or regenerating candidates must
 * never overwrite a cue the user has touched.
 *
 * Everything here is pure: it takes domain objects and 30 fps integer frames,
 * and returns either the next state with a `changed` flag or a validation
 * error. No pixels, milliseconds, React state, TTS, or audio assets.
 *
 * The state is stored under `TimelineDocument.extensions.subtitleTracks`; the
 * server command in `server/services/timelineSubtitleEditing.ts` is the only
 * writer, and it round-trips the visual slices untouched via the U1 codec.
 */

/** First version: exactly one subtitle track with this id. */
export const SUBTITLE_TRACK_ID = "subtitle";

/** The minimum structural length of any cue, in frames. */
export const MIN_SUBTITLE_CUE_FRAMES = 1;

/** How a cue's text was first seeded. `manual` cues have no upstream source. */
export type SubtitleProvenance =
  | { kind: "shot-dialogue"; stableShotId: string }
  | { kind: "chatcut-cue"; cueCode: string }
  | { kind: "manual" };

export type SubtitleCue = {
  id: string;
  /** Absolute 30 fps start, non-negative integer. */
  startFrame: number;
  /** Structural length in frames, integer >= MIN_SUBTITLE_CUE_FRAMES. */
  durationFrames: number;
  /** Authoritative display text once the track exists. */
  text: string;
  provenance: SubtitleProvenance;
  /**
   * Revision of the upstream source text this cue was last initialized or
   * explicitly reconciled from. A newer source only raises a "source updated"
   * hint; it never rewrites `text`.
   */
  sourceTextRevision: number;
  /** True once the user has edited the text away from the seeded value. */
  textEdited: boolean;
  /** True once the user has moved or trimmed the cue. */
  timingEdited: boolean;
  /**
   * Monotonic counter bumped on every text change. U5's TTS submission freezes
   * against this so a late generation cannot land on newer text.
   */
  textRevision: number;
  /** Stable relation to a narration audio clip (populated in U9). */
  speechBindingId?: string;
};

export type SubtitleTrack = {
  id: string;
  /** Sorted by (startFrame, id). Overlapping cues are read losslessly. */
  cues: SubtitleCue[];
};

export type TimelineSubtitleState = {
  tracks: SubtitleTrack[];
};

export type SubtitlePlannerOk = {
  status: "ok";
  state: TimelineSubtitleState;
  changed: boolean;
};
export type SubtitlePlannerError = { status: "error"; message: string };
export type SubtitlePlannerResult = SubtitlePlannerOk | SubtitlePlannerError;

const ok = (
  state: TimelineSubtitleState,
  changed: boolean
): SubtitlePlannerOk => ({ status: "ok", state, changed });
const err = (message: string): SubtitlePlannerError => ({
  status: "error",
  message,
});

function isInteger(value: number): boolean {
  return Number.isInteger(value);
}

function sortCues(cues: SubtitleCue[]): SubtitleCue[] {
  return [...cues].sort(
    (left, right) =>
      left.startFrame - right.startFrame || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

/** Empty, canonical subtitle state (one empty track). */
export function emptySubtitleState(): TimelineSubtitleState {
  return { tracks: [{ id: SUBTITLE_TRACK_ID, cues: [] }] };
}

/**
 * Normalize an unknown stored value into a `TimelineSubtitleState`. Unknown /
 * malformed input degrades to an empty track rather than throwing, but a
 * well-formed array of cues (including overlapping ones) is preserved verbatim.
 */
export function normalizeSubtitleState(value: unknown): TimelineSubtitleState {
  if (!value || typeof value !== "object") return emptySubtitleState();
  const tracks = Array.isArray((value as { tracks?: unknown }).tracks)
    ? ((value as { tracks: unknown[] }).tracks as unknown[])
    : Array.isArray(value)
      ? (value as unknown[])
      : null;
  if (!tracks) return emptySubtitleState();
  const firstTrack = tracks.find(
    (track): track is { id?: unknown; cues?: unknown } =>
      Boolean(track) && typeof track === "object"
  );
  const rawCues = Array.isArray(firstTrack?.cues)
    ? (firstTrack!.cues as unknown[])
    : [];
  const cues: SubtitleCue[] = [];
  for (const raw of rawCues) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      typeof record.startFrame !== "number" ||
      typeof record.durationFrames !== "number"
    ) {
      continue;
    }
    cues.push({
      id: record.id,
      startFrame: Math.max(0, Math.round(record.startFrame)),
      durationFrames: Math.max(
        MIN_SUBTITLE_CUE_FRAMES,
        Math.round(record.durationFrames)
      ),
      text: typeof record.text === "string" ? record.text : "",
      provenance: normalizeProvenance(record.provenance),
      sourceTextRevision:
        typeof record.sourceTextRevision === "number"
          ? record.sourceTextRevision
          : 0,
      textEdited: record.textEdited === true,
      timingEdited: record.timingEdited === true,
      textRevision:
        typeof record.textRevision === "number" ? record.textRevision : 0,
      ...(typeof record.speechBindingId === "string"
        ? { speechBindingId: record.speechBindingId }
        : {}),
    });
  }
  return { tracks: [{ id: SUBTITLE_TRACK_ID, cues: sortCues(cues) }] };
}

function normalizeProvenance(value: unknown): SubtitleProvenance {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.kind === "shot-dialogue" && typeof record.stableShotId === "string") {
      return { kind: "shot-dialogue", stableShotId: record.stableShotId };
    }
    if (record.kind === "chatcut-cue" && typeof record.cueCode === "string") {
      return { kind: "chatcut-cue", cueCode: record.cueCode };
    }
  }
  return { kind: "manual" };
}

function track(state: TimelineSubtitleState): SubtitleTrack {
  return state.tracks[0] ?? { id: SUBTITLE_TRACK_ID, cues: [] };
}

function withCues(cues: SubtitleCue[]): TimelineSubtitleState {
  return { tracks: [{ id: SUBTITLE_TRACK_ID, cues: sortCues(cues) }] };
}

function findCue(
  state: TimelineSubtitleState,
  cueId: string
): SubtitleCue | undefined {
  return track(state).cues.find(cue => cue.id === cueId);
}

export function subtitleCueEndFrame(cue: SubtitleCue): number {
  return cue.startFrame + cue.durationFrames;
}

/** Are two provenances the same upstream source (mergeable)? */
function sameProvenance(a: SubtitleProvenance, b: SubtitleProvenance): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "shot-dialogue" && b.kind === "shot-dialogue")
    return a.stableShotId === b.stableShotId;
  if (a.kind === "chatcut-cue" && b.kind === "chatcut-cue")
    return a.cueCode === b.cueCode;
  return true; // both manual
}

// ── Planner operations ────────────────────────────────────────────────────

export type SubtitleCandidate = {
  startFrame: number;
  durationFrames: number;
  text: string;
  provenance: SubtitleProvenance;
  sourceTextRevision: number;
};

/**
 * Seed the track from upstream candidates. Only runs when the track has no
 * cues; empty-text candidates are skipped; ids are supplied by the caller
 * (server) so replay is deterministic.
 */
export function initializeSubtitleCues(
  state: TimelineSubtitleState,
  input: { candidates: (SubtitleCandidate & { id: string })[] }
): SubtitlePlannerResult {
  if (track(state).cues.length > 0) {
    return ok(state, false);
  }
  const seeded: SubtitleCue[] = [];
  for (const candidate of input.candidates) {
    const text = candidate.text.trim();
    if (!text) continue;
    if (!isInteger(candidate.startFrame) || candidate.startFrame < 0) {
      return err("字幕候选的起始帧必须是非负整数");
    }
    if (
      !isInteger(candidate.durationFrames) ||
      candidate.durationFrames < MIN_SUBTITLE_CUE_FRAMES
    ) {
      return err("字幕候选的时长至少一帧");
    }
    seeded.push({
      id: candidate.id,
      startFrame: candidate.startFrame,
      durationFrames: candidate.durationFrames,
      text,
      provenance: candidate.provenance,
      sourceTextRevision: candidate.sourceTextRevision,
      textEdited: false,
      timingEdited: false,
      textRevision: 1,
    });
  }
  if (seeded.length === 0) return ok(state, false);
  return ok(withCues(seeded), true);
}

export function editSubtitleText(
  state: TimelineSubtitleState,
  input: { cueId: string; text: string; expectedTextRevision: number }
): SubtitlePlannerResult {
  const cue = findCue(state, input.cueId);
  if (!cue) return err("字幕块不存在");
  if (cue.textRevision !== input.expectedTextRevision) {
    return err("字幕文字已被改动，请重新加载后再编辑");
  }
  const text = input.text.replace(/\r\n?/g, "\n");
  if (text.trim().length === 0) return err("字幕文字不能为空");
  if (text === cue.text) return ok(state, false);
  return ok(
    withCues(
      track(state).cues.map(candidate =>
        candidate.id === cue.id
          ? {
              ...candidate,
              text,
              textEdited: true,
              textRevision: candidate.textRevision + 1,
            }
          : candidate
      )
    ),
    true
  );
}

export function moveSubtitleCue(
  state: TimelineSubtitleState,
  input: { cueId: string; toStartFrame: number }
): SubtitlePlannerResult {
  const cue = findCue(state, input.cueId);
  if (!cue) return err("字幕块不存在");
  if (!isInteger(input.toStartFrame) || input.toStartFrame < 0) {
    return err("字幕起始帧必须是非负整数");
  }
  if (input.toStartFrame === cue.startFrame) return ok(state, false);
  return ok(
    withCues(
      track(state).cues.map(candidate =>
        candidate.id === cue.id
          ? { ...candidate, startFrame: input.toStartFrame, timingEdited: true }
          : candidate
      )
    ),
    true
  );
}

/** Trim the head: move start by `deltaFrames`, keep the tail fixed. */
export function trimSubtitleCueStart(
  state: TimelineSubtitleState,
  input: { cueId: string; toStartFrame: number }
): SubtitlePlannerResult {
  const cue = findCue(state, input.cueId);
  if (!cue) return err("字幕块不存在");
  if (!isInteger(input.toStartFrame) || input.toStartFrame < 0) {
    return err("字幕起始帧必须是非负整数");
  }
  const end = subtitleCueEndFrame(cue);
  const nextDuration = end - input.toStartFrame;
  if (nextDuration < MIN_SUBTITLE_CUE_FRAMES) {
    return err("字幕至少保留一帧");
  }
  if (input.toStartFrame === cue.startFrame) return ok(state, false);
  return ok(
    withCues(
      track(state).cues.map(candidate =>
        candidate.id === cue.id
          ? {
              ...candidate,
              startFrame: input.toStartFrame,
              durationFrames: nextDuration,
              timingEdited: true,
            }
          : candidate
      )
    ),
    true
  );
}

/** Trim the tail: keep the head fixed, set a new end frame. */
export function trimSubtitleCueEnd(
  state: TimelineSubtitleState,
  input: { cueId: string; toEndFrame: number }
): SubtitlePlannerResult {
  const cue = findCue(state, input.cueId);
  if (!cue) return err("字幕块不存在");
  if (!isInteger(input.toEndFrame)) {
    return err("字幕结束帧必须是整数");
  }
  const nextDuration = input.toEndFrame - cue.startFrame;
  if (nextDuration < MIN_SUBTITLE_CUE_FRAMES) {
    return err("字幕至少保留一帧");
  }
  if (nextDuration === cue.durationFrames) return ok(state, false);
  return ok(
    withCues(
      track(state).cues.map(candidate =>
        candidate.id === cue.id
          ? { ...candidate, durationFrames: nextDuration, timingEdited: true }
          : candidate
      )
    ),
    true
  );
}

export function splitSubtitleCue(
  state: TimelineSubtitleState,
  input: {
    cueId: string;
    splitFrame: number;
    caretIndex: number;
    expectedTextRevision: number;
    newCueId: string;
  }
): SubtitlePlannerResult {
  const cue = findCue(state, input.cueId);
  if (!cue) return err("字幕块不存在");
  if (cue.textRevision !== input.expectedTextRevision) {
    return err("字幕文字已被改动，请重新加载后再拆分");
  }
  const start = cue.startFrame;
  const end = subtitleCueEndFrame(cue);
  if (
    !isInteger(input.splitFrame) ||
    input.splitFrame - start < MIN_SUBTITLE_CUE_FRAMES ||
    end - input.splitFrame < MIN_SUBTITLE_CUE_FRAMES
  ) {
    return err("拆分点两侧都至少要有一帧");
  }
  const normalizedText = cue.text.replace(/\r\n?/g, "\n");
  const caret = Math.max(0, Math.min(normalizedText.length, input.caretIndex));
  const leftText = normalizedText.slice(0, caret).trim();
  const rightText = normalizedText.slice(caret).trim();
  if (!leftText || !rightText) {
    return err("拆分后两段文字都不能为空");
  }
  const left: SubtitleCue = {
    ...cue,
    text: leftText,
    durationFrames: input.splitFrame - start,
    textEdited: true,
    timingEdited: true,
    textRevision: cue.textRevision + 1,
  };
  const right: SubtitleCue = {
    ...cue,
    id: input.newCueId,
    text: rightText,
    startFrame: input.splitFrame,
    durationFrames: end - input.splitFrame,
    textEdited: true,
    timingEdited: true,
    textRevision: 1,
    speechBindingId: undefined,
  };
  return ok(
    withCues([
      ...track(state).cues.filter(candidate => candidate.id !== cue.id),
      left,
      right,
    ]),
    true
  );
}

export type SubtitleMergeDirection = "previous" | "next";

export function mergeSubtitleCue(
  state: TimelineSubtitleState,
  input: { cueId: string; direction: SubtitleMergeDirection }
): SubtitlePlannerResult {
  const cues = track(state).cues;
  const index = cues.findIndex(candidate => candidate.id === input.cueId);
  if (index < 0) return err("字幕块不存在");
  const neighbourIndex =
    input.direction === "previous" ? index - 1 : index + 1;
  const neighbour = cues[neighbourIndex];
  if (!neighbour) {
    return err(
      input.direction === "previous"
        ? "前面没有可合并的字幕"
        : "后面没有可合并的字幕"
    );
  }
  const [earlier, later] =
    input.direction === "previous"
      ? [neighbour, cues[index]]
      : [cues[index], neighbour];
  if (earlier.startFrame > later.startFrame) {
    return err("只有相邻字幕可以合并");
  }
  if (!sameProvenance(earlier.provenance, later.provenance)) {
    return err("来源不同的字幕不能合并");
  }
  const mergedStart = Math.min(earlier.startFrame, later.startFrame);
  const mergedEnd = Math.max(
    subtitleCueEndFrame(earlier),
    subtitleCueEndFrame(later)
  );
  const merged: SubtitleCue = {
    ...earlier,
    startFrame: mergedStart,
    durationFrames: mergedEnd - mergedStart,
    text: `${earlier.text}\n${later.text}`,
    textEdited: true,
    timingEdited: true,
    textRevision: earlier.textRevision + 1,
  };
  return ok(
    withCues([
      ...cues.filter(
        candidate => candidate.id !== earlier.id && candidate.id !== later.id
      ),
      merged,
    ]),
    true
  );
}

export type SubtitleActionAvailability = {
  enabled: boolean;
  /** User-facing reason when disabled; null when enabled. */
  reason: string | null;
};

/**
 * Can this split run right now? Shares the planner's rules so a button is
 * never enabled for an operation the server would reject — and the disabled
 * reason is the same sentence the user would have seen on failure.
 */
export function subtitleSplitAvailability(
  state: TimelineSubtitleState,
  input: { cueId: string; splitFrame: number; caretIndex: number }
): SubtitleActionAvailability {
  const cue = findCue(state, input.cueId);
  if (!cue) return { enabled: false, reason: "字幕块不存在" };
  const result = splitSubtitleCue(state, {
    cueId: input.cueId,
    splitFrame: input.splitFrame,
    caretIndex: input.caretIndex,
    expectedTextRevision: cue.textRevision,
    newCueId: "__availability_probe__",
  });
  return result.status === "ok"
    ? { enabled: true, reason: null }
    : { enabled: false, reason: result.message };
}

/** Same idea for merge: one rule set drives both the button and the command. */
export function subtitleMergeAvailability(
  state: TimelineSubtitleState,
  input: { cueId: string; direction: SubtitleMergeDirection }
): SubtitleActionAvailability {
  const result = mergeSubtitleCue(state, input);
  return result.status === "ok"
    ? { enabled: true, reason: null }
    : { enabled: false, reason: result.message };
}

export function deleteSubtitleCue(
  state: TimelineSubtitleState,
  input: { cueId: string }
): SubtitlePlannerResult {
  const cues = track(state).cues;
  if (!cues.some(candidate => candidate.id === input.cueId)) {
    return ok(state, false);
  }
  return ok(
    withCues(
      cues.filter(candidate => candidate.id !== input.cueId)
    ),
    true
  );
}

/** All cues active at `frame`, in stable (startFrame, id) order. */
export function resolveSubtitleCuesAtFrame(
  state: TimelineSubtitleState,
  frame: number
): SubtitleCue[] {
  return sortCues(
    track(state).cues.filter(
      cue => frame >= cue.startFrame && frame < subtitleCueEndFrame(cue)
    )
  );
}

/** Highest end frame across every cue (0 when empty). */
export function subtitleStateEndFrame(state: TimelineSubtitleState): number {
  return track(state).cues.reduce(
    (max, cue) => Math.max(max, subtitleCueEndFrame(cue)),
    0
  );
}
