import type {
  StoryTimelineImageClip,
  TimelineTransform,
} from "./storyMaterial";
import type { VisualEditDocument } from "./visualClipModel";
import type { VisualObjectRef } from "./visualObject";
import { normalizeVisualLayer } from "./timelineVisualPriority";
import { shotIdentityFromShot } from "./shotIdentity";
import type {
  StoryTimelineItem,
  StoryTimelineImageTextOverlay,
  StoryTimelinePrimaryVideoEdit,
  StoryTimelineVisualClip,
} from "./storyMaterial";

export type ImageClipClipboardSnapshot = Readonly<{
  version: 1;
  kind: "image-clip";
  sourceStoryId: number;
  /** Provenance only. A paste always receives a new clip identity and host. */
  sourceClipId: string;
  sourceLayer: number;
  imageId: number;
  imageUrl: string;
  label: string;
  durationFrames: number;
  transform: Readonly<TimelineTransform> | null;
}>;

export type StoryShotClipboardTimelineSnapshot = Readonly<{
  included: boolean;
  plannedDurationMs: number;
  durationFrames: number;
  transform: Readonly<TimelineTransform>;
  referencedImageId?: number;
  imageTransforms?: Readonly<Record<string, Readonly<TimelineTransform>>>;
  imageTextOverlays?: Readonly<
    Record<string, Readonly<StoryTimelineImageTextOverlay>>
  >;
  primaryVideoEdit?: Readonly<StoryTimelinePrimaryVideoEdit>;
  visualClipsReplacePrimary: boolean;
  visualClips: readonly Readonly<StoryTimelineVisualClip>[];
}>;

export type StoryShotClipboardSnapshot = Readonly<{
  version: 1;
  kind: "story-shot";
  sourceStoryId: number;
  /** Provenance only. Paste always allocates a new shot identity. */
  sourceStableShotId: string;
  sourceLayer: number;
  /** Explicitly allow-listed user-visible story fields. */
  shot: Readonly<Record<string, unknown>>;
  timeline: StoryShotClipboardTimelineSnapshot;
}>;

export type VisualObjectClipboardSnapshot =
  | ImageClipClipboardSnapshot
  | StoryShotClipboardSnapshot;

const STORY_SHOT_CLIPBOARD_FIELDS = [
  "sceneNo",
  "sceneTitle",
  "sceneArtBrief",
  "cueCode",
  "actNo",
  "subject",
  "action",
  "scriptText",
  "performance",
  "environmentMotion",
  "dialogue",
  "voiceAudioUrl",
  "voiceAudioText",
  "voiceAudioProvider",
  "voiceAudioVoice",
  "voiceAudioGeneratedAt",
  "shotType",
  "beat",
  "cameraAngle",
  "cameraMove",
  "cameraHeight",
  "lens",
  "cameraPath",
  "subjectPath",
  "location",
  "timeLight",
  "lighting",
  "colorPalette",
  "materialTexture",
  "mood",
  "sound",
  "soundBridge",
  "styleRef",
  "note",
  "emotion",
  "sourceCardContent",
  "intent",
  "rationale",
  "videoStart",
  "videoEnd",
  "transitionIn",
  "transitionOut",
  "transitionIntent",
  "videoPrompt",
  "emotionCharge",
  "emotionDelta",
  "visualAnchorText",
  "promptDraft",
  "negativePrompt",
  "characterReference",
  "wardrobeReference",
  "hairReference",
  "sceneReference",
  "textureReference",
  "generationModel",
  "generationParams",
  "fragmentRefs",
  "promptOverrides",
  "narrativeJob",
] as const;

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        cloneJsonValue(nested),
      ])
    );
  }
  return value;
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      freezeDeep(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function copyTransform(transform: TimelineTransform): TimelineTransform {
  return {
    cropX: transform.cropX,
    cropY: transform.cropY,
    cropWidth: transform.cropWidth,
    cropHeight: transform.cropHeight,
    zoom: transform.zoom,
    panX: transform.panX,
    panY: transform.panY,
    ...(transform.rotationDeg == null
      ? {}
      : { rotationDeg: transform.rotationDeg }),
    ...(transform.flipX == null ? {} : { flipX: transform.flipX }),
    ...(transform.flipY == null ? {} : { flipY: transform.flipY }),
  };
}

function copyPrimaryVideoEdit(
  edit: StoryTimelinePrimaryVideoEdit
): StoryTimelinePrimaryVideoEdit {
  return {
    takeId: edit.takeId,
    sourceStartSec: edit.sourceStartSec,
    sourceEndSec: edit.sourceEndSec,
    effects: {
      ...edit.effects,
      ...(edit.effects.motionPreset
        ? { motionPreset: { ...edit.effects.motionPreset } }
        : {}),
    },
  };
}

function copyOwnedClip(clip: StoryTimelineVisualClip): StoryTimelineVisualClip {
  return {
    id: clip.id,
    takeId: clip.takeId,
    rangeId: clip.rangeId,
    sourceStableShotId: clip.sourceStableShotId,
    videoUrl: clip.videoUrl,
    label: clip.label,
    sourceStartSec: clip.sourceStartSec,
    sourceEndSec: clip.sourceEndSec,
    offsetMs: clip.offsetMs,
    durationMs: clip.durationMs,
    ...(clip.effects
      ? {
          effects: {
            ...clip.effects,
            ...(clip.effects.motionPreset
              ? { motionPreset: { ...clip.effects.motionPreset } }
              : {}),
          },
        }
      : {}),
    ...(clip.transform ? { transform: copyTransform(clip.transform) } : {}),
    ...(clip.visualLayer == null
      ? {}
      : { visualLayer: normalizeVisualLayer(clip.visualLayer) }),
  };
}

function immutableStoryShotSnapshot(input: {
  storyId: number;
  shot: Record<string, unknown>;
  item: StoryTimelineItem;
}): StoryShotClipboardSnapshot {
  const shot = Object.fromEntries(
    STORY_SHOT_CLIPBOARD_FIELDS.flatMap(field =>
      Object.prototype.hasOwnProperty.call(input.shot, field)
        ? [[field, cloneJsonValue(input.shot[field])]]
        : []
    )
  );
  const imageTransforms = input.item.imageTransforms
    ? Object.fromEntries(
        Object.entries(input.item.imageTransforms).map(([id, transform]) => [
          id,
          copyTransform(transform),
        ])
      )
    : undefined;
  const timeline: StoryShotClipboardTimelineSnapshot = {
    included: input.item.included,
    plannedDurationMs: input.item.plannedDurationMs,
    durationFrames: Math.max(
      1,
      Math.round(
        input.item.durationFrames ?? (input.item.plannedDurationMs * 30) / 1000
      )
    ),
    transform: copyTransform(input.item.transform),
    ...(input.item.referencedImageId == null
      ? {}
      : { referencedImageId: input.item.referencedImageId }),
    ...(imageTransforms ? { imageTransforms } : {}),
    ...(input.item.imageTextOverlays
      ? {
          imageTextOverlays: cloneJsonValue(
            input.item.imageTextOverlays
          ) as Record<string, StoryTimelineImageTextOverlay>,
        }
      : {}),
    ...(input.item.primaryVideoEdit
      ? { primaryVideoEdit: copyPrimaryVideoEdit(input.item.primaryVideoEdit) }
      : {}),
    visualClipsReplacePrimary: Boolean(input.item.visualClipsReplacePrimary),
    visualClips: (input.item.visualClips ?? []).map(copyOwnedClip),
  };
  return freezeDeep({
    version: 1 as const,
    kind: "story-shot" as const,
    sourceStoryId: input.storyId,
    sourceStableShotId: input.item.stableShotId,
    sourceLayer: normalizeVisualLayer(input.item.visualLayer),
    shot,
    timeline,
  });
}

function immutableImageSnapshot(input: {
  storyId: number;
  clip: StoryTimelineImageClip;
}): ImageClipClipboardSnapshot {
  const transform = input.clip.transform
    ? Object.freeze({ ...input.clip.transform })
    : null;
  return Object.freeze({
    version: 1 as const,
    kind: "image-clip" as const,
    sourceStoryId: input.storyId,
    sourceClipId: input.clip.id,
    sourceLayer: normalizeVisualLayer(input.clip.visualLayer),
    imageId: input.clip.imageId,
    imageUrl: input.clip.imageUrl,
    label: input.clip.label,
    durationFrames: Math.max(1, Math.round(input.clip.durationFrames)),
    transform,
  });
}

/** Build a value snapshot from the canonical document, never from DOM state. */
export function snapshotVisualObjectForClipboard(input: {
  storyId: number;
  document: VisualEditDocument;
  object: VisualObjectRef;
  storyShots?: readonly Record<string, unknown>[];
}): VisualObjectClipboardSnapshot | null {
  const object = input.object;
  if (object.type === "story-shot") {
    const item = input.document.items.find(
      candidate => candidate.stableShotId === object.stableShotId
    );
    const shot = input.storyShots?.find(
      (candidate, index) => shotIdentityFromShot(candidate, index) === object.stableShotId
    );
    return item && shot
      ? immutableStoryShotSnapshot({ storyId: input.storyId, shot, item })
      : null;
  }
  if (object.type !== "image-clip") return null;
  const owner = input.document.items.find(
    item => item.stableShotId === object.ownerStableShotId
  );
  const clip = owner?.imageClips?.find(
    candidate => candidate.id === object.clipId
  );
  return clip ? immutableImageSnapshot({ storyId: input.storyId, clip }) : null;
}

/** Clone at trust boundaries so no caller can retain a mutable nested value. */
export function cloneVisualObjectClipboardSnapshot(
  snapshot: VisualObjectClipboardSnapshot
): VisualObjectClipboardSnapshot {
  if (snapshot.kind === "story-shot") {
    return immutableStoryShotSnapshot({
      storyId: snapshot.sourceStoryId,
      shot: snapshot.shot as Record<string, unknown>,
      item: {
        stableShotId: snapshot.sourceStableShotId,
        position: 0,
        visualLayer: snapshot.sourceLayer,
        ...(snapshot.timeline as Omit<
          StoryTimelineItem,
          "stableShotId" | "position" | "transform" | "visualClips"
        >),
        transform: snapshot.timeline.transform as TimelineTransform,
        visualClips: snapshot.timeline.visualClips as StoryTimelineVisualClip[],
      },
    });
  }
  return immutableImageSnapshot({
    storyId: snapshot.sourceStoryId,
    clip: {
      id: snapshot.sourceClipId,
      imageId: snapshot.imageId,
      imageUrl: snapshot.imageUrl,
      label: snapshot.label,
      offsetFrames: 0,
      durationFrames: snapshot.durationFrames,
      visualLayer: snapshot.sourceLayer,
      ...(snapshot.transform ? { transform: { ...snapshot.transform } } : {}),
    },
  });
}
