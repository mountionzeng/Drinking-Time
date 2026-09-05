/**
 * Formal U6 audio lanes. They share the Storyboard viewport and interaction
 * shell, but every mutation remains a narrow intent handled by timelineMedia.
 * This component never constructs the next Timeline document or owns assets.
 */
import { useCallback, useState } from "react";
import {
  audioClipEndFrame,
  type AudioClip,
  type AudioTrack,
  type TimelineAudioState,
} from "@shared/timelineAudioModel";
import {
  frameToPx,
  pxDeltaToFrame,
  type TimelineViewport,
} from "@shared/timelineViewport";
import { timelineFramesToMs } from "@shared/storyMaterial";
import { storyboardEditPlayheadPx } from "../storyboardEditRow";
import {
  StoryboardAudioWaveformFill,
  type StoryboardAudioClip,
} from "../views/StoryboardAudioWaveform";
import {
  AUDIO_KIND_ORDER,
  timelineMediaKindProfile,
} from "./timelineMediaCapabilities";
import { cancelTimelinePointerDrag } from "./timelinePointerDrag";
import type { TimelineNarrationCandidate } from "./useTimelineMediaController";

const DRAG_THRESHOLD_PX = 4;

type AudioDragKind = "move" | "trim-start" | "trim-end";
type AudioDragState = {
  clipId: string;
  kind: AudioDragKind;
  pointerId: number;
  originX: number;
  viewport: TimelineViewport;
  clip: AudioClip;
  deltaFrames: number;
  passedThreshold: boolean;
};

export type AudioTrackRowCallbacks = {
  onSelectClip: (clipId: string | null) => void;
  onMove: (input: {
    clipId: string;
    toStartFrame: number;
  }) => Promise<void> | void;
  onTrim: (input: {
    clipId: string;
    edge: "start" | "end";
    deltaFrames: number;
  }) => Promise<void> | void;
  onDelete: (clipId: string) => Promise<void> | void;
};

export type AudioTrackBinding = AudioTrackRowCallbacks & {
  storyId: number;
  audioState: TimelineAudioState;
  selectedClipId: string | null;
  pending: boolean;
  error: string | null;
  onSetGain: (input: { clipId: string; gain: number }) => Promise<void> | void;
  onSetMuted: (input: {
    clipId: string;
    muted: boolean;
  }) => Promise<void> | void;
  onSetFade: (input: {
    clipId: string;
    fadeInFrames?: number;
    fadeOutFrames?: number;
  }) => Promise<void> | void;
  onReclassify: (input: {
    clipId: string;
    toKind: AudioTrack["kind"];
  }) => Promise<void> | void;
  narrationCandidates?: TimelineNarrationCandidate[];
  onGenerateNarration?: (subtitleCueId: string) => Promise<boolean>;
  onAdoptNarrationCandidate?: (input: {
    subtitleCueId: string;
    candidateAssetId: number;
    expectedTextRevision: number;
  }) => Promise<void> | void;
  onDiscardNarrationCandidate?: (candidateAssetId: number) => Promise<boolean>;
};

export function audioAssetUrl(storyId: number, assetId: number): string {
  return `/api/story-audio-asset/${storyId}/${assetId}`;
}

export function audioClipPlacement(
  clip: Pick<AudioClip, "timelineStartFrame" | "durationFrames">,
  viewport: TimelineViewport
): { leftPx: number; widthPx: number } {
  const leftPx = frameToPx(viewport, clip.timelineStartFrame);
  return {
    leftPx,
    widthPx: Math.max(
      4,
      frameToPx(viewport, clip.timelineStartFrame + clip.durationFrames) -
        leftPx
    ),
  };
}

/** Preview a gesture while preserving the no-speed source-duration identity. */
export function audioClipDragGhost(
  clip: AudioClip,
  drag: Pick<AudioDragState, "kind" | "deltaFrames" | "passedThreshold"> | null
): AudioClip {
  if (!drag || !drag.passedThreshold || drag.deltaFrames === 0) return clip;
  if (drag.kind === "move") {
    return {
      ...clip,
      timelineStartFrame: Math.max(
        0,
        clip.timelineStartFrame + drag.deltaFrames
      ),
    };
  }
  if (drag.kind === "trim-start") {
    const minDelta = Math.max(-clip.sourceInFrame, -clip.timelineStartFrame);
    const maxDelta = clip.durationFrames - 1;
    const delta = Math.max(minDelta, Math.min(maxDelta, drag.deltaFrames));
    return {
      ...clip,
      timelineStartFrame: clip.timelineStartFrame + delta,
      sourceInFrame: clip.sourceInFrame + delta,
      durationFrames: clip.durationFrames - delta,
    };
  }
  const delta = Math.max(-(clip.durationFrames - 1), drag.deltaFrames);
  return {
    ...clip,
    sourceOutFrame: clip.sourceOutFrame + delta,
    durationFrames: clip.durationFrames + delta,
  };
}

function waveformClip(
  storyId: number,
  kind: AudioTrack["kind"],
  clip: AudioClip
): StoryboardAudioClip {
  return {
    id: clip.id,
    name: `素材-${clip.assetId}`,
    kind:
      kind === "narration" ? "voice" : kind === "music" ? "music" : "source",
    audioUrl: audioAssetUrl(storyId, clip.assetId),
    startMs: timelineFramesToMs(clip.timelineStartFrame),
    endMs: timelineFramesToMs(audioClipEndFrame(clip)),
    sourceInMs: timelineFramesToMs(clip.sourceInFrame),
    sourceOutMs: timelineFramesToMs(clip.sourceOutFrame),
  };
}

export function AudioTrackRow({
  storyId,
  track,
  viewport,
  playheadMs,
  selectedClipId,
  pending,
  error,
  onSelectClip,
  onMove,
  onTrim,
  onDelete,
}: {
  storyId: number;
  track: AudioTrack;
  viewport: TimelineViewport;
  playheadMs: number;
  selectedClipId: string | null;
  pending: boolean;
  error: string | null;
} & AudioTrackRowCallbacks) {
  const [drag, setDrag] = useState<AudioDragState | null>(null);
  const profile = timelineMediaKindProfile(track.kind);
  const playheadPx = storyboardEditPlayheadPx(playheadMs, viewport);

  const beginDrag = useCallback(
    (
      event: React.PointerEvent<HTMLElement>,
      clip: AudioClip,
      kind: AudioDragKind
    ) => {
      if (pending || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      onSelectClip(clip.id);
      setDrag({
        clipId: clip.id,
        kind,
        pointerId: event.pointerId,
        originX: event.clientX,
        viewport,
        clip,
        deltaFrames: 0,
        passedThreshold: false,
      });
    },
    [onSelectClip, pending, viewport]
  );

  const updateDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    setDrag(current => {
      if (!current || current.pointerId !== event.pointerId) return current;
      const dx = event.clientX - current.originX;
      const passedThreshold =
        current.passedThreshold || Math.abs(dx) >= DRAG_THRESHOLD_PX;
      if (!passedThreshold) return current;
      return {
        ...current,
        passedThreshold,
        deltaFrames: pxDeltaToFrame(current.viewport, dx),
      };
    });
  }, []);

  const finishDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const current = drag;
      setDrag(null);
      if (
        !current ||
        current.pointerId !== event.pointerId ||
        !current.passedThreshold
      ) {
        return;
      }
      const ghost = audioClipDragGhost(current.clip, current);
      if (current.kind === "move") {
        if (ghost.timelineStartFrame !== current.clip.timelineStartFrame) {
          void onMove({
            clipId: current.clipId,
            toStartFrame: ghost.timelineStartFrame,
          });
        }
        return;
      }
      const deltaFrames =
        current.kind === "trim-start"
          ? ghost.sourceInFrame - current.clip.sourceInFrame
          : ghost.sourceOutFrame - current.clip.sourceOutFrame;
      if (deltaFrames !== 0) {
        void onTrim({
          clipId: current.clipId,
          edge: current.kind === "trim-start" ? "start" : "end",
          deltaFrames,
        });
      }
    },
    [drag, onMove, onTrim]
  );
  const cancelDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    setDrag(current => cancelTimelinePointerDrag(current, event.pointerId));
  }, []);

  const onClipKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>, clip: AudioClip) => {
      if (pending) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        void onDelete(clip.id);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onSelectClip(null);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const delta = event.key === "ArrowLeft" ? -1 : 1;
        void onMove({
          clipId: clip.id,
          toStartFrame: Math.max(0, clip.timelineStartFrame + delta),
        });
      }
    },
    [onDelete, onMove, onSelectClip, pending]
  );

  const onHandleKeyDown = useCallback(
    (
      event: React.KeyboardEvent<HTMLElement>,
      clip: AudioClip,
      edge: "start" | "end"
    ) => {
      if (pending) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      const desired = event.key === "ArrowLeft" ? -1 : 1;
      const ghost = audioClipDragGhost(clip, {
        kind: edge === "start" ? "trim-start" : "trim-end",
        deltaFrames: desired,
        passedThreshold: true,
      });
      const deltaFrames =
        edge === "start"
          ? ghost.sourceInFrame - clip.sourceInFrame
          : ghost.sourceOutFrame - clip.sourceOutFrame;
      if (deltaFrames !== 0)
        void onTrim({ clipId: clip.id, edge, deltaFrames });
    },
    [onTrim, pending]
  );

  const rovingId = track.clips.some(clip => clip.id === selectedClipId)
    ? selectedClipId
    : (track.clips[0]?.id ?? null);

  return (
    <div
      className="relative h-12 min-w-0 overflow-hidden border-b border-r bg-muted/10"
      style={{
        borderColor: "color-mix(in srgb, var(--panel-border) 62%, transparent)",
      }}
      aria-label={`${profile.label}轨`}
      data-testid={`storyboard-audio-track-${track.kind}`}
      onPointerMove={updateDrag}
      onPointerUp={finishDrag}
      onPointerCancel={cancelDrag}
    >
      {track.clips.map(clip => {
        const activeDrag = drag?.clipId === clip.id ? drag : null;
        const ghost = audioClipDragGhost(clip, activeDrag);
        const placement = audioClipPlacement(ghost, viewport);
        const selected = selectedClipId === clip.id;
        return (
          <div
            key={clip.id}
            role="button"
            tabIndex={clip.id === rovingId ? 0 : -1}
            aria-label={`${profile.label} · 素材 ${clip.assetId}`}
            aria-selected={selected}
            data-timeline-media-keyboard="true"
            data-testid={`storyboard-audio-clip-${clip.id}`}
            data-selected={selected ? "true" : "false"}
            className={`absolute bottom-1 top-1 overflow-hidden rounded-[2px] border ${profile.tone} ${clip.muted || track.muted ? "opacity-45" : ""} ${activeDrag?.passedThreshold ? "opacity-70" : ""}`}
            style={{ left: placement.leftPx, width: placement.widthPx }}
            onPointerDown={event => beginDrag(event, clip, "move")}
            onClick={() => onSelectClip(clip.id)}
            onKeyDown={event => onClipKeyDown(event, clip)}
          >
            <StoryboardAudioWaveformFill
              clip={waveformClip(storyId, track.kind, ghost)}
            />
            <span
              role="slider"
              tabIndex={selected ? 0 : -1}
              aria-label={`${profile.label}入点`}
              aria-valuenow={clip.sourceInFrame}
              data-testid={`storyboard-audio-handle-start-${clip.id}`}
              className="absolute bottom-0 left-0 top-0 z-10 w-1.5 cursor-ew-resize bg-current opacity-0 focus:opacity-60"
              onPointerDown={event => beginDrag(event, clip, "trim-start")}
              onKeyDown={event => onHandleKeyDown(event, clip, "start")}
            />
            <span className="pointer-events-none absolute bottom-0 left-1.5 max-w-[calc(100%-12px)] truncate bg-[var(--background)]/75 px-1 font-mono text-[7px] leading-3">
              {profile.label} · 素材 #{clip.assetId}
              {clip.textStale ? " · 文字已变化" : ""}
            </span>
            <span
              role="slider"
              tabIndex={selected ? 0 : -1}
              aria-label={`${profile.label}出点`}
              aria-valuenow={clip.sourceOutFrame}
              data-testid={`storyboard-audio-handle-end-${clip.id}`}
              className="absolute bottom-0 right-0 top-0 z-10 w-1.5 cursor-ew-resize bg-current opacity-0 focus:opacity-60"
              onPointerDown={event => beginDrag(event, clip, "trim-end")}
              onKeyDown={event => onHandleKeyDown(event, clip, "end")}
            />
          </div>
        );
      })}
      {playheadPx != null ? (
        <span
          className="pointer-events-none absolute bottom-0 top-0 z-30 w-px -translate-x-1/2 bg-rose-500"
          style={{ left: playheadPx }}
          data-testid={`storyboard-audio-playhead-${track.kind}`}
        />
      ) : null}
      <span aria-live="polite" className="sr-only">
        {pending ? `${profile.label}保存中` : (error ?? "")}
      </span>
    </div>
  );
}

function AudioTrackHeader({
  kind,
  action,
}: {
  kind: AudioTrack["kind"] | null;
  action?: React.ReactNode;
}) {
  const label = kind ? timelineMediaKindProfile(kind).label : "声音";
  return (
    <div
      role="rowheader"
      className="sticky left-0 z-20 flex items-center justify-between gap-1 border-b border-r px-2 py-2 text-[9px] font-semibold text-muted-foreground"
      style={{
        borderColor: "color-mix(in srgb, var(--panel-border) 62%, transparent)",
        background: "var(--background)",
      }}
      data-testid={kind ? `storyboard-audio-header-${kind}` : undefined}
    >
      <span>{label}</span>
      {action}
    </div>
  );
}

/** Render content tracks by default; all five empty tracks collapse to one row. */
export function AudioTrackSection({
  storyId,
  audioState,
  viewport,
  playheadMs,
  selectedClipId,
  pending,
  error,
  onSelectClip,
  onMove,
  onTrim,
  onDelete,
  onRequestAdd,
  addControl,
  columnSpan = 1,
}: {
  storyId: number;
  audioState: TimelineAudioState;
  viewport: TimelineViewport;
  playheadMs: number;
  selectedClipId: string | null;
  pending: boolean;
  error: string | null;
  onRequestAdd: () => void;
  addControl?: React.ReactNode;
  columnSpan?: number;
} & AudioTrackRowCallbacks) {
  const [showEmpty, setShowEmpty] = useState(false);
  const contentTracks = AUDIO_KIND_ORDER.map(kind =>
    audioState.tracks.find(track => track.kind === kind)
  ).filter((track): track is AudioTrack => Boolean(track?.clips.length));

  if (contentTracks.length === 0) {
    return (
      <>
        <AudioTrackHeader
          kind={null}
          action={
            addControl ?? (
              <button
                type="button"
                disabled={pending}
                onClick={onRequestAdd}
                className="rounded-sm border border-border px-1.5 py-0.5 text-[8px] font-medium text-foreground disabled:opacity-40"
              >
                添加声音
              </button>
            )
          }
        />
        <div
          role="cell"
          style={{ gridColumn: `span ${Math.max(1, columnSpan)}` }}
          data-testid="storyboard-audio-empty-row"
          className="flex h-12 items-center justify-center border-b border-r text-[8px] text-muted-foreground/70"
        >
          旁白、音乐、环境声、音效和原声会显示在这里
        </div>
      </>
    );
  }

  const visibleTracks = showEmpty
    ? AUDIO_KIND_ORDER.map(kind =>
        audioState.tracks.find(track => track.kind === kind)
      ).filter((track): track is AudioTrack => Boolean(track))
    : contentTracks;
  return (
    <>
      {visibleTracks.map((track, index) => (
        <div key={track.kind} className="contents">
          <AudioTrackHeader
            kind={track.kind}
            action={
              index === 0 ? (
                <button
                  type="button"
                  onClick={() => setShowEmpty(value => !value)}
                  className="text-[7px] font-normal text-muted-foreground underline-offset-2 hover:underline"
                >
                  {showEmpty ? "收起空轨" : "显示空轨"}
                </button>
              ) : undefined
            }
          />
          <div
            role="cell"
            style={{ gridColumn: `span ${Math.max(1, columnSpan)}` }}
          >
            <AudioTrackRow
              storyId={storyId}
              track={track}
              viewport={viewport}
              playheadMs={playheadMs}
              selectedClipId={selectedClipId}
              pending={pending}
              error={error}
              onSelectClip={onSelectClip}
              onMove={onMove}
              onTrim={onTrim}
              onDelete={onDelete}
            />
          </div>
        </div>
      ))}
    </>
  );
}
