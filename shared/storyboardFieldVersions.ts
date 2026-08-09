import { shotIdentityFromShot } from "./shotIdentity";

export const STORYBOARD_VERSIONED_FIELDS = [
  "scriptText",
  "promptDraft",
  "videoPrompt",
  "dialogue",
] as const;

export type StoryboardVersionedField =
  (typeof STORYBOARD_VERSIONED_FIELDS)[number];

export function isStoryboardVersionedField(
  value: string
): value is StoryboardVersionedField {
  return (STORYBOARD_VERSIONED_FIELDS as readonly string[]).includes(value);
}

export type StoryboardFieldVersionSource = "generated" | "edited" | "restored";

export type StoryboardFieldVersionEntry = {
  revision: number;
  createdAt: number;
  source: StoryboardFieldVersionSource;
  restoredFromRevision?: number;
  values: Record<string, StoryboardFieldVersionValue>;
  shotOrder?: string[];
};

export type StoryboardFieldVersionValue =
  | string
  | { dialogue: string; sound: string };

export type StoryboardFieldVersionTrack = {
  currentRevision: number;
  history: StoryboardFieldVersionEntry[];
};

export type StoryboardFieldVersions = {
  version: 1;
  tracks: Record<StoryboardVersionedField, StoryboardFieldVersionTrack>;
};

export const MAX_STORYBOARD_FIELD_VERSION_HISTORY = 50;

type VersionableShot = Record<string, unknown>;

function emptyTrack(): StoryboardFieldVersionTrack {
  return { currentRevision: 0, history: [] };
}

function boundedHistory(
  history: StoryboardFieldVersionEntry[]
): StoryboardFieldVersionEntry[] {
  if (history.length <= MAX_STORYBOARD_FIELD_VERSION_HISTORY) return history;
  return [
    history[0]!,
    ...history.slice(-(MAX_STORYBOARD_FIELD_VERSION_HISTORY - 1)),
  ];
}

export function emptyStoryboardFieldVersions(): StoryboardFieldVersions {
  return {
    version: 1,
    tracks: {
      scriptText: emptyTrack(),
      promptDraft: emptyTrack(),
      videoPrompt: emptyTrack(),
      dialogue: emptyTrack(),
    },
  };
}

function normalizeEntry(value: unknown): StoryboardFieldVersionEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.revision !== "number" ||
    !Number.isInteger(raw.revision) ||
    raw.revision < 1 ||
    typeof raw.createdAt !== "number" ||
    !Number.isFinite(raw.createdAt) ||
    !["generated", "edited", "restored"].includes(String(raw.source)) ||
    !raw.values ||
    typeof raw.values !== "object" ||
    Array.isArray(raw.values)
  ) {
    return null;
  }
  const values: Record<string, StoryboardFieldVersionValue> = {};
  for (const [identity, content] of Object.entries(
    raw.values as Record<string, unknown>
  )) {
    if (!identity.trim()) continue;
    if (typeof content === "string") {
      values[identity] = content;
      continue;
    }
    if (content && typeof content === "object" && !Array.isArray(content)) {
      const voice = content as Record<string, unknown>;
      if (
        typeof voice.dialogue === "string" &&
        typeof voice.sound === "string"
      ) {
        values[identity] = {
          dialogue: voice.dialogue,
          sound: voice.sound,
        };
      }
    }
  }
  return {
    revision: raw.revision,
    createdAt: raw.createdAt,
    source: raw.source as StoryboardFieldVersionSource,
    ...(typeof raw.restoredFromRevision === "number" &&
    Number.isInteger(raw.restoredFromRevision) &&
    raw.restoredFromRevision > 0
      ? { restoredFromRevision: raw.restoredFromRevision }
      : {}),
    values,
    shotOrder: Array.isArray(raw.shotOrder)
      ? raw.shotOrder.filter(
          (identity): identity is string =>
            typeof identity === "string" &&
            Object.prototype.hasOwnProperty.call(values, identity)
        )
      : Object.keys(values),
  };
}

function normalizeTrack(value: unknown): StoryboardFieldVersionTrack {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyTrack();
  }
  const raw = value as Record<string, unknown>;
  const history = boundedHistory(
    (Array.isArray(raw.history) ? raw.history : [])
      .map(normalizeEntry)
      .filter((entry): entry is StoryboardFieldVersionEntry => Boolean(entry))
      .filter(
        (entry, index, entries) =>
          entries.findIndex(
            candidate => candidate.revision === entry.revision
          ) === index
      )
      .sort((left, right) => left.revision - right.revision)
  );
  return {
    currentRevision: history.at(-1)?.revision ?? 0,
    history,
  };
}

export function normalizeStoryboardFieldVersions(
  value: unknown
): StoryboardFieldVersions {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const tracks =
    raw.tracks && typeof raw.tracks === "object" && !Array.isArray(raw.tracks)
      ? (raw.tracks as Record<string, unknown>)
      : {};
  return {
    version: 1,
    tracks: {
      scriptText: normalizeTrack(tracks.scriptText),
      promptDraft: normalizeTrack(tracks.promptDraft),
      videoPrompt: normalizeTrack(tracks.videoPrompt),
      dialogue: normalizeTrack(tracks.dialogue),
    },
  };
}

function valuesForField(
  shots: readonly VersionableShot[],
  field: StoryboardVersionedField
): Record<string, StoryboardFieldVersionValue> {
  const values: Record<string, StoryboardFieldVersionValue> = {};
  shots.forEach((shot, index) => {
    const identity = shotIdentityFromShot(shot, index);
    if (!identity) return;
    values[identity] =
      field === "dialogue"
        ? {
            dialogue: typeof shot.dialogue === "string" ? shot.dialogue : "",
            sound: typeof shot.sound === "string" ? shot.sound : "",
          }
        : typeof shot[field] === "string"
          ? (shot[field] as string)
          : "";
  });
  return values;
}

function sameValues(
  left: Record<string, StoryboardFieldVersionValue>,
  right: Record<string, StoryboardFieldVersionValue>
): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return Array.from(keys).every(
    key => JSON.stringify(left[key] ?? "") === JSON.stringify(right[key] ?? "")
  );
}

function appendSnapshot(input: {
  track: StoryboardFieldVersionTrack;
  values: Record<string, StoryboardFieldVersionValue>;
  now: number;
  source: StoryboardFieldVersionSource;
  restoredFromRevision?: number;
}): StoryboardFieldVersionTrack {
  const current = input.track.history.at(-1);
  if (current && sameValues(current.values, input.values)) return input.track;
  const revision = (current?.revision ?? 0) + 1;
  return {
    currentRevision: revision,
    history: boundedHistory([
      ...input.track.history,
      {
        revision,
        createdAt: input.now,
        source: input.source,
        ...(input.restoredFromRevision
          ? { restoredFromRevision: input.restoredFromRevision }
          : {}),
        values: input.values,
        shotOrder: Object.keys(input.values),
      },
    ]),
  };
}

export function initializeStoryboardFieldVersions(
  state: unknown,
  shots: readonly VersionableShot[],
  now: number,
  source: StoryboardFieldVersionSource = "generated"
): StoryboardFieldVersions {
  const normalized = normalizeStoryboardFieldVersions(state);
  return {
    ...normalized,
    tracks: Object.fromEntries(
      STORYBOARD_VERSIONED_FIELDS.map(field => {
        const track = normalized.tracks[field];
        return [
          field,
          track.currentRevision > 0
            ? track
            : appendSnapshot({
                track,
                values: valuesForField(shots, field),
                now,
                source,
              }),
        ];
      })
    ) as StoryboardFieldVersions["tracks"],
  };
}

export function recordStoryboardFieldVersions(input: {
  state: unknown;
  beforeShots: readonly VersionableShot[];
  afterShots: readonly VersionableShot[];
  fields: readonly StoryboardVersionedField[];
  now: number;
  source: Exclude<StoryboardFieldVersionSource, "restored">;
  initializeFrom?: "before" | "after";
}): StoryboardFieldVersions {
  let next = normalizeStoryboardFieldVersions(input.state);
  for (const field of input.fields) {
    let track = next.tracks[field];
    if (track.currentRevision === 0) {
      const initialShots =
        input.initializeFrom === "after" ? input.afterShots : input.beforeShots;
      track = appendSnapshot({
        track,
        values: valuesForField(initialShots, field),
        now: input.now,
        source: input.source,
      });
    }
    track = appendSnapshot({
      track,
      values: valuesForField(input.afterShots, field),
      now: input.now,
      source: input.source,
    });
    next = {
      ...next,
      tracks: { ...next.tracks, [field]: track },
    };
  }
  return next;
}

export function restoreStoryboardFieldVersion(input: {
  state: unknown;
  shots: readonly VersionableShot[];
  field: StoryboardVersionedField;
  revision: number;
  now: number;
}): { state: StoryboardFieldVersions; shots: VersionableShot[] } {
  const state = normalizeStoryboardFieldVersions(input.state);
  const track = state.tracks[input.field];
  const target = track.history.find(item => item.revision === input.revision);
  if (!target) throw new Error(`找不到 V${input.revision}`);
  const currentIdentities = new Set(
    input.shots.flatMap((shot, index) => {
      const identity = shotIdentityFromShot(shot, index);
      return identity ? [identity] : [];
    })
  );
  const targetShotOrder = target.shotOrder ?? Object.keys(target.values);
  const hasExactIdentityMatch = targetShotOrder.some(identity =>
    currentIdentities.has(identity)
  );
  const consumedTargetIdentities = new Set<string>();
  const shots = input.shots.map((shot, index) => {
    const identity = shotIdentityFromShot(shot, index);
    if (!identity) return { ...shot };
    const targetIdentity = Object.prototype.hasOwnProperty.call(
      target.values,
      identity
    )
      ? identity
      : !hasExactIdentityMatch
        ? targetShotOrder.find(
            candidate => !consumedTargetIdentities.has(candidate)
          )
        : undefined;
    if (targetIdentity) consumedTargetIdentities.add(targetIdentity);
    const targetValue = targetIdentity
      ? target.values[targetIdentity]
      : undefined;
    // 整批重生成会让所有稳定 ID 一起变化，此时才允许按镜头顺序恢复。
    // 只插入或删除部分镜头时，新增镜头必须保留当前值，不能偷取仍属于
    // 其他现存镜头的历史内容。
    if (targetValue === undefined) return { ...shot };
    if (
      input.field === "dialogue" &&
      targetValue &&
      typeof targetValue === "object"
    ) {
      return {
        ...shot,
        dialogue: targetValue.dialogue,
        sound: targetValue.sound,
      };
    }
    return {
      ...shot,
      [input.field]: typeof targetValue === "string" ? targetValue : "",
    };
  });
  const restoredTrack = appendSnapshot({
    track,
    values: valuesForField(shots, input.field),
    now: input.now,
    source: "restored",
    restoredFromRevision: input.revision,
  });
  return {
    shots,
    state: {
      ...state,
      tracks: { ...state.tracks, [input.field]: restoredTrack },
    },
  };
}
