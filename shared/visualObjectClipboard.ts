import type {
  StoryTimelineImageClip,
  TimelineTransform,
} from "./storyMaterial";
import type { VisualEditDocument } from "./visualClipModel";
import type { VisualObjectRef } from "./visualObject";

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

export type VisualObjectClipboardSnapshot = ImageClipClipboardSnapshot;

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
    sourceLayer: Math.max(0, Math.round(input.clip.visualLayer)),
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
}): VisualObjectClipboardSnapshot | null {
  const object = input.object;
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
