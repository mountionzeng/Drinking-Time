import {
  insertVisualImageClip,
  materializeAbsolutePlacements,
  projectVisualClips,
  visualTrackId,
  type InsertVisualClipResult,
  type RemoveVisualClipResult,
  type VisualEditDocument,
} from "./visualClipModel";
import type { VisualObjectRef } from "./visualObject";
import type { ImageClipClipboardSnapshot } from "./visualObjectClipboard";

export type PasteImageClipboardResult =
  | InsertVisualClipResult
  | {
      status: "error";
      error: "story-mismatch" | "clip-identity-reused";
      message: string;
    };

/** Paste a non-owning image reference at an explicit absolute frame/layer. */
export function pasteImageClipboardSnapshot(input: {
  document: VisualEditDocument;
  storyId: number;
  snapshot: ImageClipClipboardSnapshot;
  newClipId: string;
  targetFrame: number;
  targetLayer: number;
  /** Server adapters replace the snapshot URL with the re-authorized asset URL. */
  canonicalImageUrl?: string;
}): PasteImageClipboardResult {
  if (input.snapshot.sourceStoryId !== input.storyId) {
    return {
      status: "error",
      error: "story-mismatch",
      message: "剪贴板属于另一个故事，请重新复制",
    };
  }
  if (!input.newClipId || input.newClipId === input.snapshot.sourceClipId) {
    return {
      status: "error",
      error: "clip-identity-reused",
      message: "粘贴必须生成新的图片块身份",
    };
  }
  return insertVisualImageClip(input.document, {
    clipId: input.newClipId,
    imageId: input.snapshot.imageId,
    imageUrl: input.canonicalImageUrl ?? input.snapshot.imageUrl,
    label: input.snapshot.label,
    trackId: visualTrackId(input.targetLayer),
    startFrame: input.targetFrame,
    durationFrames: input.snapshot.durationFrames,
    ...(input.snapshot.transform
      ? { transform: { ...input.snapshot.transform } }
      : {}),
  });
}

export type DeleteVisualObjectResult =
  | RemoveVisualClipResult
  | {
      status: "error";
      error: "unsupported-kind";
      message: string;
    };

/** Narrow delete: remove only the selected clip reference, never its asset. */
export function deleteVisualObjectReference(input: {
  document: VisualEditDocument;
  object: VisualObjectRef;
}): DeleteVisualObjectResult {
  switch (input.object.type) {
    case "image-clip": {
      const object = input.object;
      const base = materializeAbsolutePlacements(input.document);
      const removed = projectVisualClips(base).find(
        clip =>
          clip.origin.kind === "image-clip" &&
          clip.origin.ownerStableShotId === object.ownerStableShotId &&
          clip.origin.clipId === object.clipId
      );
      if (!removed) {
        return {
          status: "error",
          error: "clip-not-found",
          message: `时间线上找不到这个素材：${object.clipId}`,
        };
      }
      return {
        status: "ok",
        removed,
        document: {
          ...base,
          items: base.items.map(item =>
            item.stableShotId === object.ownerStableShotId
              ? {
                  ...item,
                  imageClips: (item.imageClips ?? []).filter(
                    clip => clip.id !== object.clipId
                  ),
                }
              : item
          ),
        },
      };
    }
    case "owned-video-clip": {
      const object = input.object;
      const base = materializeAbsolutePlacements(input.document);
      const removed = projectVisualClips(base).find(
        clip =>
          clip.origin.kind === "video-clip" &&
          clip.origin.ownerStableShotId === object.ownerStableShotId &&
          clip.origin.clipId === object.clipId
      );
      if (!removed) {
        return {
          status: "error",
          error: "clip-not-found",
          message: `时间线上找不到这个素材：${object.clipId}`,
        };
      }
      return {
        status: "ok",
        removed,
        document: {
          ...base,
          items: base.items.map(item =>
            item.stableShotId === object.ownerStableShotId
              ? {
                  ...item,
                  visualClips: (item.visualClips ?? []).filter(
                    clip => clip.id !== object.clipId
                  ),
                  visualClipsReplacePrimary:
                    (item.visualClips ?? []).filter(
                      clip => clip.id !== object.clipId
                    ).length > 0 && Boolean(item.visualClipsReplacePrimary),
                }
              : item
          ),
        },
      };
    }
    case "story-shot":
      return {
        status: "error",
        error: "unsupported-kind",
        message: "完整镜头删除必须同时修改故事与时间线",
      };
  }
}
