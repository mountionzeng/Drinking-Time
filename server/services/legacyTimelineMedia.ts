import { STORY_TIMELINE_FPS } from "../../shared/storyMaterial";
import {
  emptyAudioState,
  type AudioTrackKind,
  type TimelineAudioState,
} from "../../shared/timelineAudioModel";
import {
  SUBTITLE_TRACK_ID,
  type TimelineSubtitleState,
} from "../../shared/timelineSubtitleModel";

type UnknownRecord = Record<string, unknown>;

export type LegacyExportAudioSource = {
  assetId: number;
  clipId: string;
  displayName: string;
  url: string;
};

export type LegacyTimelineMediaProjection = {
  subtitleState: TimelineSubtitleState;
  audioState: TimelineAudioState;
  audioSources: LegacyExportAudioSource[];
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cueCode(name: string): string | null {
  return (
    name.match(/(?:^|\b)(?:VO[-_ ]?|FR[-_ ]?)(\d{4}(?:-\d)?)/i)?.[1] ?? null
  );
}

function audioKind(name: string): AudioTrackKind {
  if (cueCode(name)) return "narration";
  if (/bgm|music|配乐|音乐/i.test(name)) return "music";
  return "source";
}

/**
 * Read-only adapter used only when the matching formal Timeline slice is
 * absent. It projects ChatCut's source fps into the canonical 30fps media
 * model without writing anything back to the Story or Timeline.
 */
export function projectLegacyTimelineMedia(
  storyBody: unknown
): LegacyTimelineMediaProjection {
  const imported = record(record(storyBody).chatCutImport);
  if (text(imported.sourceFormat) !== "xmeml") {
    return {
      subtitleState: { tracks: [{ id: SUBTITLE_TRACK_ID, cues: [] }] },
      audioState: emptyAudioState(),
      audioSources: [],
    };
  }

  const fps = Math.max(1, finiteNumber(imported.fps, STORY_TIMELINE_FPS));
  const toTimelineFrame = (value: unknown) =>
    Math.max(0, Math.round((finiteNumber(value) * STORY_TIMELINE_FPS) / fps));
  const rawTracks = Array.isArray(imported.audioTracks)
    ? imported.audioTracks.map(record)
    : [];
  const availableIndexes = new Set(
    rawTracks.map(track =>
      Math.max(1, Math.round(finiteNumber(track.index, 1)))
    )
  );
  const configuredIndexes = Array.isArray(imported.playbackAudioTrackIndexes)
    ? imported.playbackAudioTrackIndexes
        .map(value => Math.round(finiteNumber(value)))
        .filter(value => availableIndexes.has(value))
    : [];
  const playbackIndexes = new Set(
    configuredIndexes.length > 0 ? configuredIndexes : availableIndexes
  );
  const cueTextByCode = new Map(
    (Array.isArray(imported.scriptCues) ? imported.scriptCues : [])
      .map(record)
      .flatMap(cue => {
        const code = text(cue.code);
        const value = text(cue.text);
        return code && value ? ([[code, value]] as const) : [];
      })
  );

  const audioState = emptyAudioState();
  const audioSources: LegacyExportAudioSource[] = [];
  const subtitleCues: TimelineSubtitleState["tracks"][number]["cues"] = [];
  let nextAssetId = -1;

  for (const track of rawTracks) {
    const trackIndex = Math.max(1, Math.round(finiteNumber(track.index, 1)));
    if (!playbackIndexes.has(trackIndex)) continue;
    const clips = Array.isArray(track.clips) ? track.clips.map(record) : [];
    for (const clip of clips) {
      const clipId = text(clip.id);
      const name = text(clip.name) || clipId;
      const url = text(clip.audioUrl);
      const timelineStartFrame = toTimelineFrame(clip.startFrame);
      const timelineEndFrame = toTimelineFrame(clip.endFrame);
      if (!clipId || timelineEndFrame <= timelineStartFrame) continue;

      const code = cueCode(name);
      const cueText = code ? cueTextByCode.get(code) : undefined;
      if (code && cueText) {
        subtitleCues.push({
          id: `legacy-chatcut-subtitle:${clipId}`,
          startFrame: timelineStartFrame,
          durationFrames: timelineEndFrame - timelineStartFrame,
          text: cueText,
          provenance: { kind: "chatcut-cue", cueCode: code },
          sourceTextRevision: 0,
          textEdited: false,
          timingEdited: false,
          textRevision: 0,
        });
      }
      if (!url) continue;

      const sourceInFrame = toTimelineFrame(clip.inFrame);
      const rawSourceOutFrame = toTimelineFrame(clip.outFrame);
      const durationFrames = timelineEndFrame - timelineStartFrame;
      const sourceOutFrame = Math.max(
        sourceInFrame + 1,
        rawSourceOutFrame,
        sourceInFrame + durationFrames
      );
      const assetId = nextAssetId--;
      const kind = audioKind(name);
      audioState.tracks
        .find(candidate => candidate.kind === kind)!
        .clips.push({
          id: `legacy-chatcut-audio:${clipId}`,
          assetId,
          timelineStartFrame,
          sourceInFrame,
          sourceOutFrame,
          durationFrames,
          gain: 1,
          muted: false,
          fadeInFrames: 0,
          fadeOutFrames: 0,
        });
      audioSources.push({ assetId, clipId, displayName: name, url });
    }
  }

  subtitleCues.sort(
    (left, right) =>
      left.startFrame - right.startFrame || left.id.localeCompare(right.id)
  );
  for (const track of audioState.tracks) {
    track.clips.sort(
      (left, right) =>
        left.timelineStartFrame - right.timelineStartFrame ||
        left.id.localeCompare(right.id)
    );
  }
  return {
    subtitleState: { tracks: [{ id: SUBTITLE_TRACK_ID, cues: subtitleCues }] },
    audioState,
    audioSources,
  };
}
