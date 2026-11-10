import {
  AUDIO_TRACK_KINDS,
  normalizeAudioState,
  type AudioTrack,
} from "./timelineAudioModel";
import {
  normalizeSubtitleState,
  type TimelineSubtitleState,
} from "./timelineSubtitleModel";
import {
  confirmedBookVideoVersions,
  type BookVideoRecord,
} from "./bookVideoCreation";

export const VIDEO_MEDIA_KINDS = ["subtitles", ...AUDIO_TRACK_KINDS] as const;
export type VideoMediaKind = (typeof VIDEO_MEDIA_KINDS)[number];
export type VideoMediaValue = TimelineSubtitleState | AudioTrack;
export type VideoMediaVersion = {
  id: string;
  kind: VideoMediaKind;
  planId: string | null;
  number: number;
  createdAt: number;
  authorUserId?: number;
  authorName?: string;
  intent: string;
  value: VideoMediaValue;
};
export type VideoMediaVersions = {
  schemaVersion: 1;
  entries: VideoMediaVersion[];
  current: Partial<Record<VideoMediaKind, string>>;
};
export type VideoMediaSelection = { kind: VideoMediaKind; versionId: string };
export type VideoMediaVersionList = {
  current: VideoMediaVersions["current"];
  entries: Array<Omit<VideoMediaVersion, "value"> & { label: string }>;
};

type Body = {
  bookVideoRecords?: BookVideoRecord[];
  shots?: Array<{ publishingVideo?: { groupId?: string } }>;
  publishing?: { activeVideoStoryboardGroupId?: string };
  videoWorkflow?: {
    versions?: Array<{
      planId?: string;
      createdAt: number;
      author?: { userId?: number; name?: string };
      material?: { timeline?: { extensions?: Record<string, unknown> } };
    }>;
  };
};
const asBody = (body: unknown) => (body ?? {}) as Body;
const groupOf = (record: BookVideoRecord) =>
  `publishing-group-${record.versionId}-${record.preview?.previewId}`;
export function activeVideoPlanId(
  body: unknown,
  shots?: Body["shots"]
): string | null {
  const b = asBody(body);
  const groupId =
    shots !== undefined
      ? shots.find(shot => shot.publishingVideo?.groupId)?.publishingVideo
          ?.groupId
      : b.publishing?.activeVideoStoryboardGroupId;
  return (
    b.bookVideoRecords?.find(record => groupOf(record) === groupId)?.id ?? null
  );
}
export function videoMediaVersionLabel(
  entry: Pick<VideoMediaVersion, "planId" | "number">,
  body: unknown
) {
  const film = confirmedBookVideoVersions(
    asBody(body).bookVideoRecords ?? []
  ).find(item => item.record.id === entry.planId);
  return film
    ? `V${String(film.version).padStart(2, "0")}.${entry.number}`
    : `V—.${entry.number}`;
}
export function videoMediaValue(
  kind: VideoMediaKind,
  extensions: Record<string, unknown>
): VideoMediaValue {
  return kind === "subtitles"
    ? normalizeSubtitleState(extensions.subtitleTracks)
    : normalizeAudioState(extensions.audioTracks).tracks.find(
        track => track.kind === kind
      )!;
}
/** Restoring allocates fresh object identities; revisions and binding bookkeeping are not content. */
export function mediaContentKey(
  kind: VideoMediaKind,
  value: VideoMediaValue
): string {
  if (kind === "subtitles")
    return JSON.stringify(
      (value as TimelineSubtitleState).tracks.map(track =>
        track.cues
          .map(cue => [cue.text, cue.startFrame, cue.durationFrames])
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      )
    );
  const track = value as AudioTrack;
  return JSON.stringify([
    track.kind,
    track.muted,
    track.defaultGain,
    track.clips.map(clip => [
      clip.assetId,
      clip.timelineStartFrame,
      clip.sourceInFrame,
      clip.sourceOutFrame,
      clip.gain,
      clip.muted,
      clip.fadeInFrames,
      clip.fadeOutFrames,
      clip.speakerId,
      clip.speakerLabel,
      clip.linkedVisualSourceId,
    ]),
  ]);
}
function hasContent(kind: VideoMediaKind, value: VideoMediaValue) {
  return kind === "subtitles"
    ? (value as TimelineSubtitleState).tracks.some(track => track.cues.length)
    : Boolean((value as AudioTrack).clips.length);
}
function capture(
  state: VideoMediaVersions,
  extensions: Record<string, unknown>,
  context: {
    planId: string | null;
    createdAt: number;
    authorUserId?: number;
    authorName?: string;
  },
  selection?: VideoMediaSelection,
  preserveSelection = false,
  intent?: string
) {
  for (const kind of VIDEO_MEDIA_KINDS) {
    const value = videoMediaValue(kind, extensions);
    const current = state.entries.find(
      entry => entry.id === state.current[kind]
    );
    if (selection?.kind === kind) {
      const selected = state.entries.find(
        entry => entry.id === selection.versionId && entry.kind === kind
      );
      if (
        !selected ||
        mediaContentKey(kind, selected.value) !== mediaContentKey(kind, value)
      )
        throw new Error("版本内容已变化，请刷新后重试");
      state.current[kind] = selected.id;
      continue;
    }
    if (!current && !hasContent(kind, value)) continue;
    if (
      current &&
      (preserveSelection || current.planId === context.planId) &&
      mediaContentKey(kind, current.value) === mediaContentKey(kind, value)
    )
      continue;
    const lastInFilm = state.entries
      .filter(entry => entry.kind === kind && entry.planId === context.planId)
      .at(-1);
    if (
      current?.planId !== context.planId &&
      lastInFilm &&
      mediaContentKey(kind, lastInFilm.value) === mediaContentKey(kind, value)
    ) {
      state.current[kind] = lastInFilm.id;
      continue;
    }
    const entry: VideoMediaVersion = {
      ...context,
      kind,
      value: structuredClone(value),
      id: `media-version-${state.entries.length + 1}`,
      number:
        Math.max(
          0,
          ...state.entries
            .filter(
              entry => entry.kind === kind && entry.planId === context.planId
            )
            .map(entry => entry.number)
        ) + 1,
      intent:
        intent?.trim() || (kind === "subtitles" ? "保存字幕内容与时间" : "保存声音素材与剪辑设置"),
    };
    state.entries.push(entry);
    state.current[kind] = entry.id;
  }
}

/** Read-only hydration includes old movie snapshots. Opening a menu never writes. */
export function readVideoMediaVersions(
  body: unknown,
  extensions: Record<string, unknown>,
  now: number
): VideoMediaVersions {
  const raw = extensions.videoMediaVersions as VideoMediaVersions | undefined;
  if (raw) {
    if (raw.schemaVersion !== 1 || !Array.isArray(raw.entries) || !raw.current)
      throw new Error("声音与字幕版本记录无法读取");
    return structuredClone(raw);
  }
  const state: VideoMediaVersions = {
    schemaVersion: 1,
    entries: [],
    current: {},
  };
  const b = asBody(body);
  const events = (b.videoWorkflow?.versions ?? []).flatMap(version =>
    version.material?.timeline?.extensions
      ? [
          {
            extensions: version.material.timeline.extensions,
            planId: version.planId ?? null,
            createdAt: version.createdAt,
            authorUserId: version.author?.userId,
            authorName: version.author?.name,
          },
        ]
      : []
  );
  const edits = extensions.videoEditHistory as
    | {
        revisions?: Array<{
          savedAt: number;
          shots?: Body["shots"];
          timeline?: { extensions?: Record<string, unknown> };
        }>;
      }
    | undefined;
  for (const edit of edits?.revisions ?? [])
    if (edit.timeline?.extensions)
      events.push({
        extensions: edit.timeline.extensions,
        planId: activeVideoPlanId(body, edit.shots ?? []),
        createdAt: edit.savedAt,
        authorUserId: undefined,
        authorName: undefined,
      });
  events
    .sort((a, b) => a.createdAt - b.createdAt)
    .forEach(event => capture(state, event.extensions, event));
  const planId = activeVideoPlanId(body),
    record = b.bookVideoRecords?.find(record => record.id === planId);
  capture(state, extensions, {
    planId,
    createdAt: record?.confirmedAt ?? now,
    authorUserId: record?.confirmedBy?.userId,
    authorName: record?.confirmedBy?.name,
  });
  return state;
}

/** Called inside the existing Story/Timeline CAS. No history is pruned or accepted from a client. */
export function recordVideoMediaVersions(input: {
  previousBody: unknown;
  nextBody: unknown;
  previousExtensions: Record<string, unknown>;
  nextExtensions: Record<string, unknown>;
  userId: number;
  savedAt: number;
  selection?: VideoMediaSelection;
  intent?: string;
}): VideoMediaVersions {
  const state = readVideoMediaVersions(
    input.previousBody,
    input.previousExtensions,
    input.savedAt
  );
  capture(
    state,
    input.nextExtensions,
    {
      planId: activeVideoPlanId(input.nextBody),
      createdAt: input.savedAt,
      authorUserId: input.userId,
    },
    input.selection,
    activeVideoPlanId(input.previousBody) === activeVideoPlanId(input.nextBody),
    input.intent
  );
  if (
    state.entries.length > 2000 ||
    new TextEncoder().encode(JSON.stringify(state)).length > 4 * 1024 * 1024
  )
    throw new Error(
      "声音与字幕历史已达容量上限，本次修改未保存，所有旧版本仍保留。请在新作品中继续。"
    );
  return state;
}

export function listVideoMediaVersions(
  state: VideoMediaVersions,
  body: unknown,
  owner?: { userId: number; name?: string }
): VideoMediaVersionList {
  return {
    current: state.current,
    entries: state.entries.map(({ value: _value, ...entry }) => ({
      ...entry,
      authorName:
        entry.authorName ??
        (entry.authorUserId === owner?.userId ? owner?.name : undefined),
      label: videoMediaVersionLabel(entry, body),
    })),
  };
}

export function videoMediaHistoryAssetIds(
  body: unknown,
  extensions: Record<string, unknown>
): Set<number> {
  const history = readVideoMediaVersions(body, extensions, 0);
  return new Set(
    history.entries.flatMap(entry =>
      entry.kind === "subtitles"
        ? []
        : (entry.value as AudioTrack).clips.map(clip => clip.assetId)
    )
  );
}
