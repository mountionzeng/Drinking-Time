import {
  normalizeStoryboardFieldVersions,
  type StoryboardVersionedField,
} from "./storyboardFieldVersions";
import { readVideoEditHistory } from "./videoEditHistory";
import { shotIdentityFromShot } from "./shotIdentity";
import type { ChatImageRevision } from "./chatImageRevision";
import type { VideoTakeAsset } from "./videoAsset";

export type ShotChange = {
  id: string;
  at: number;
  title: string;
  revision?: number;
  snapshot?: boolean;
  editorUserId?: number;
  before?: string;
  after?: string;
  instruction?: string;
  images?: { imageId: number; imageUrl: string }[];
  video?: { takeId: number; url: string; selected: boolean };
};
export const SHOT_FIELD_LABELS: Record<StoryboardVersionedField, string> = {
  scriptText: "剧本",
  promptDraft: "图片要求",
  videoPrompt: "视频要求",
  dialogue: "台词与声音",
};
const fieldText = (value: string | { dialogue: string; sound: string }) =>
  typeof value === "string"
    ? value
    : [value.dialogue, value.sound].filter(Boolean).join("\n\n");

/** Project existing records for one stable shot. Never infer history from its current number. */
export function shotChangeHistory(input: {
  storyId: number;
  stableShotId: string;
  fields?: unknown;
  videoHistory?: unknown;
  images?: readonly ChatImageRevision[];
  takes?: readonly VideoTakeAsset[];
  messages?: readonly {
    id: string;
    role: string;
    content: string;
    timestamp: number;
    selectionQuote?: { storyId?: number | null; stableShotId?: string | null };
  }[];
}): ShotChange[] {
  if (!input.stableShotId) return [];
  const changes: ShotChange[] = [];
  const state = normalizeStoryboardFieldVersions(input.fields);
  for (const field of Object.keys(
    SHOT_FIELD_LABELS
  ) as StoryboardVersionedField[]) {
    let previous: string | undefined;
    for (const entry of state.tracks[field].history) {
      const value = entry.values[input.stableShotId];
      if (value === undefined) continue;
      const after = fieldText(value);
      if (after !== previous)
        changes.push({
          id: `${field}:${entry.revision}`,
          at: entry.createdAt,
          title: SHOT_FIELD_LABELS[field],
          revision: entry.revision,
          before: previous,
          after,
          editorUserId: entry.editorUserId,
        });
      previous = after;
    }
  }
  let previousEdit: string | undefined;
  const previousFields = new Map<string, string>();
  for (const entry of [...readVideoEditHistory(input.videoHistory)].sort(
    (a, b) => a.version - b.version
  )) {
    const shot = entry.shots.find(
      (s, index) => shotIdentityFromShot(s, index) === input.stableShotId
    );
    if (!shot) continue;
    const items = Array.isArray(entry.timeline.items)
      ? entry.timeline.items
      : [];
    const item = items.find(
      (i: Record<string, unknown>) => i?.stableShotId === input.stableShotId
    );
    // Shot numbers and labels change on reorder without changing this shot's media.
    const {
      shotNo: _shotNo,
      label: _label,
      cueCode: _cueCode,
      ...media
    } = item ?? {};
    const snapshot = JSON.stringify({ durationMs: shot.durationMs, media });
    if (previousEdit !== undefined && snapshot !== previousEdit)
      changes.push({
        id: `edit:${entry.version}`,
        at: entry.savedAt,
        title: "剪辑位置与素材",
        revision: entry.version,
        after:
          typeof shot.durationMs === "number"
            ? `${(shot.durationMs / 1000).toFixed(2)} s`
            : undefined,
      });
    previousEdit = snapshot;
    // Legacy autosaves did not retain field versions. Show surviving snapshots
    // as snapshots, never claim their savedAt is the original edit time.
    for (const field of Object.keys(
      SHOT_FIELD_LABELS
    ) as StoryboardVersionedField[]) {
      if (
        state.tracks[field].history.some(
          e => e.values[input.stableShotId] !== undefined
        )
      )
        continue;
      const after =
        field === "dialogue"
          ? [shot.dialogue, shot.sound]
              .filter(v => typeof v === "string" && v)
              .join("\n\n")
          : typeof shot[field] === "string"
            ? (shot[field] as string)
            : undefined;
      if (after === undefined) continue;
      const before = previousFields.get(field);
      if (after !== before && (after || before))
        changes.push({
          id: `snapshot:${entry.version}:${field}`,
          at: entry.savedAt,
          title: SHOT_FIELD_LABELS[field],
          snapshot: true,
          revision: entry.version,
          before,
          after,
        });
      previousFields.set(field, after);
    }
  }
  for (const image of input.images ?? []) {
    if (image.stableShotId !== input.stableShotId) continue;
    changes.push({
      id: `image:${image.requestId}`,
      at: image.createdAt,
      title: image.requestId.startsWith("image:")
        ? "历史图片"
        : image.status === "succeeded"
          ? "生成图片"
          : image.status === "failed"
            ? "图片生成未完成"
            : "图片生成中",
      instruction: image.instruction,
      editorUserId: image.editorUserId,
      images: image.candidates,
    });
    if (image.decision && !image.requestId.startsWith("image:"))
      changes.push({
        id: `decision:${image.requestId}`,
        at: image.decision.at,
        title: image.decision.kind === "replaced" ? "采用图片" : "保留原图",
        editorUserId: image.decision.userId,
        after: image.decision.imageId
          ? `#${image.sourceImageId} → #${image.decision.imageId}`
          : `#${image.sourceImageId}`,
      });
  }
  for (const message of input.messages ?? []) {
    if (
      message.role !== "user" ||
      message.selectionQuote?.storyId !== input.storyId ||
      message.selectionQuote.stableShotId !== input.stableShotId
    )
      continue;
    changes.push({
      id: `message:${message.id}`,
      at: message.timestamp,
      title: "对话要求",
      instruction: message.content,
    });
  }
  for (const take of input.takes ?? []) {
    if (
      take.storyId !== input.storyId ||
      take.stableShotId !== input.stableShotId
    )
      continue;
    changes.push({
      id: `take:${take.id}`,
      at: Date.parse(take.createdAt) || 0,
      title:
        take.status === "available"
          ? "生成视频"
          : ["submitted", "processing"].includes(take.status)
            ? "视频生成中"
            : "视频生成未完成",
      instruction: take.prompt,
      editorUserId: take.userId,
      ...(take.status === "available" && take.videoUrl
        ? {
            video: {
              takeId: take.id,
              url: take.videoUrl,
              selected: take.isTimelineSelected,
            },
          }
        : {}),
    });
  }
  return changes.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
}
