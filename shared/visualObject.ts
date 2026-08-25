import type { VisualClipOrigin } from "./visualClipModel";

export type StoryShotVisualObjectRef = {
  type: "story-shot";
  stableShotId: string;
  shotNo?: number;
};

export type OwnedVideoClipVisualObjectRef = {
  type: "owned-video-clip";
  clipId: string;
  ownerStableShotId: string;
};

export type ImageClipVisualObjectRef = {
  type: "image-clip";
  clipId: string;
  ownerStableShotId: string;
};

export type VisualObjectRef =
  | StoryShotVisualObjectRef
  | OwnedVideoClipVisualObjectRef
  | ImageClipVisualObjectRef;

export function visualObjectRefKey(ref: VisualObjectRef): string {
  return ref.type === "story-shot"
    ? `${ref.type}:${ref.stableShotId}`
    : `${ref.type}:${ref.clipId}`;
}

/** Legacy overlays remain readable visual clips, but are not editable objects. */
export function visualObjectRefFromClip(clip: {
  id: string;
  origin: VisualClipOrigin;
}): VisualObjectRef | null {
  switch (clip.origin.kind) {
    case "shot":
      return { type: "story-shot", stableShotId: clip.origin.stableShotId };
    case "video-clip":
      return {
        type: "owned-video-clip",
        clipId: clip.origin.clipId,
        ownerStableShotId: clip.origin.ownerStableShotId,
      };
    case "image-clip":
      return {
        type: "image-clip",
        clipId: clip.origin.clipId,
        ownerStableShotId: clip.origin.ownerStableShotId,
      };
    case "overlay":
      return null;
  }
}
