import {
  insertVisualImageClip,
  materializeAbsolutePlacements,
  projectVisualClips,
  selectImageClipHostForFrame,
  visualTrackId,
  type InsertVisualClipResult,
  type RemoveVisualClipResult,
  type VisualEditDocument,
} from "./visualClipModel";
import type { VisualObjectRef } from "./visualObject";
import type { ImageClipClipboardSnapshot } from "./visualObjectClipboard";
import type { StoryShotClipboardSnapshot } from "./visualObjectClipboard";
import type { StoryTimelineItem } from "./storyMaterial";
import { normalizeVisualLayer } from "./timelineVisualPriority";

export type StoryShotRecord = Record<string, unknown> & {
  shotNo?: number;
  stableShotId?: unknown;
  shotIdentity?: unknown;
};

export type StoryVisualAggregate<
  TShot extends StoryShotRecord = StoryShotRecord,
> = {
  shots: readonly TShot[];
  document: VisualEditDocument;
};

type StoryAggregatePlannerError =
  | "story-mismatch"
  | "shot-not-found"
  | "timeline-item-not-found"
  | "identity-reused"
  | "clip-identity-count-mismatch"
  | "invalid-target"
  | "last-shot";

export type StoryAggregatePlannerResult<TShot extends StoryShotRecord> =
  | {
      status: "ok";
      aggregate: { shots: TShot[]; document: VisualEditDocument };
    }
  | { status: "error"; error: StoryAggregatePlannerError; message: string };

function storyIdentity(shot: StoryShotRecord): string | null {
  return typeof shot.stableShotId === "string"
    ? shot.stableShotId
    : typeof shot.shotIdentity === "string"
      ? shot.shotIdentity
      : null;
}

function copyTimelineTransform(
  transform: StoryShotClipboardSnapshot["timeline"]["transform"]
) {
  return { ...transform };
}

/** Pure aggregate paste planner. Identity allocation is supplied by the adapter. */
export function pasteStoryShotClipboardSnapshot<
  TShot extends StoryShotRecord,
>(input: {
  aggregate: StoryVisualAggregate<TShot>;
  storyId: number;
  snapshot: StoryShotClipboardSnapshot;
  newStableShotId: string;
  newOwnedClipIds: readonly string[];
  targetFrame: number;
  targetLayer: number;
}): StoryAggregatePlannerResult<TShot> {
  if (input.snapshot.sourceStoryId !== input.storyId) {
    return {
      status: "error",
      error: "story-mismatch",
      message: "剪贴板属于另一个故事，请重新复制",
    };
  }
  const existingIdentities = new Set(
    input.aggregate.shots.map(storyIdentity).filter(Boolean)
  );
  if (
    !input.newStableShotId ||
    existingIdentities.has(input.newStableShotId) ||
    input.newStableShotId === input.snapshot.sourceStableShotId
  ) {
    return {
      status: "error",
      error: "identity-reused",
      message: "粘贴必须生成新的镜头身份",
    };
  }
  if (
    input.newOwnedClipIds.length !== input.snapshot.timeline.visualClips.length
  ) {
    return {
      status: "error",
      error: "clip-identity-count-mismatch",
      message: "内部片段的新身份数量不匹配",
    };
  }
  const allExistingClipIds = new Set(
    input.aggregate.document.items.flatMap(item =>
      (item.visualClips ?? []).map(clip => clip.id)
    )
  );
  const newClipIds = new Set(input.newOwnedClipIds);
  if (
    newClipIds.size !== input.newOwnedClipIds.length ||
    input.newOwnedClipIds.some(
      (id, index) =>
        !id ||
        id === input.snapshot.timeline.visualClips[index]?.id ||
        allExistingClipIds.has(id)
    )
  ) {
    return {
      status: "error",
      error: "identity-reused",
      message: "粘贴必须为全部内部片段生成新身份",
    };
  }
  if (
    !Number.isFinite(input.targetFrame) ||
    input.targetFrame < 0 ||
    !Number.isFinite(input.targetLayer) ||
    input.targetLayer < 0
  ) {
    return {
      status: "error",
      error: "invalid-target",
      message: "镜头落点必须是有效的非负帧和图层",
    };
  }
  const targetFrame = Math.max(0, Math.round(input.targetFrame));
  const layer = normalizeVisualLayer(input.targetLayer);
  const base = materializeAbsolutePlacements(input.aggregate.document);
  const item: StoryTimelineItem = {
    stableShotId: input.newStableShotId,
    included: input.snapshot.timeline.included,
    position: base.items.length,
    plannedDurationMs: input.snapshot.timeline.plannedDurationMs,
    durationFrames: input.snapshot.timeline.durationFrames,
    timelineStartFrame: targetFrame,
    visualLayer: layer,
    transform: copyTimelineTransform(input.snapshot.timeline.transform),
    ...(input.snapshot.timeline.referencedImageId == null
      ? {}
      : { referencedImageId: input.snapshot.timeline.referencedImageId }),
    ...(input.snapshot.timeline.imageTransforms
      ? {
          imageTransforms: Object.fromEntries(
            Object.entries(input.snapshot.timeline.imageTransforms).map(
              ([id, transform]) => [id, copyTimelineTransform(transform)]
            )
          ),
        }
      : {}),
    ...(input.snapshot.timeline.imageTextOverlays
      ? {
          imageTextOverlays: structuredClone(
            input.snapshot.timeline.imageTextOverlays
          ) as StoryTimelineItem["imageTextOverlays"],
        }
      : {}),
    ...(input.snapshot.timeline.primaryVideoEdit
      ? {
          primaryVideoEdit: structuredClone(
            input.snapshot.timeline.primaryVideoEdit
          ),
        }
      : {}),
    visualClipsReplacePrimary:
      input.snapshot.timeline.visualClipsReplacePrimary,
    visualClips: input.snapshot.timeline.visualClips.map((clip, index) => ({
      ...structuredClone(clip),
      id: input.newOwnedClipIds[index],
      sourceStableShotId: input.newStableShotId,
      ...(clip.visualLayer == null
        ? {}
        : {
            visualLayer: normalizeVisualLayer(
              clip.visualLayer + layer - input.snapshot.sourceLayer
            ),
          }),
    })),
  };
  // Stable sort: existing members of an equal-start group precede the pasted shot.
  const orderedItems = [...base.items, item]
    .map((candidate, insertionOrder) => ({
      candidate,
      insertionOrder,
      pasted: candidate === item,
    }))
    .sort(
      (left, right) =>
        (left.candidate.timelineStartFrame ?? 0) -
          (right.candidate.timelineStartFrame ?? 0) ||
        // `position`, not array order, is the canonical existing Story order.
        // A pasted shot is deliberately last inside its equal-start group.
        (left.pasted ? Number.MAX_SAFE_INTEGER : left.candidate.position) -
          (right.pasted ? Number.MAX_SAFE_INTEGER : right.candidate.position) ||
        left.insertionOrder - right.insertionOrder
    )
    .map(({ candidate }, position) => ({ ...candidate, position }));
  const shotById = new Map(
    input.aggregate.shots.map(shot => [storyIdentity(shot), shot] as const)
  );
  const pastedShot = {
    ...input.snapshot.shot,
    stableShotId: input.newStableShotId,
    shotIdentity: input.newStableShotId,
    shotKey: input.newStableShotId,
  } as unknown as TShot;
  shotById.set(input.newStableShotId, pastedShot);
  if (orderedItems.some(candidate => !shotById.has(candidate.stableShotId))) {
    return {
      status: "error",
      error: "shot-not-found",
      message: "故事与时间线镜头不一致",
    };
  }
  const shots = orderedItems.map((candidate, index) => ({
    ...shotById.get(candidate.stableShotId)!,
    stableShotId: candidate.stableShotId,
    shotIdentity: candidate.stableShotId,
    shotNo: index + 1,
  }));
  return {
    status: "ok",
    aggregate: { shots, document: { ...base, items: orderedItems } },
  };
}

/** Pure aggregate delete planner. Independent image clips are deterministically rehosted. */
export function deleteStoryShotAggregate<TShot extends StoryShotRecord>(input: {
  aggregate: StoryVisualAggregate<TShot>;
  stableShotId: string;
}): StoryAggregatePlannerResult<TShot> {
  if (
    input.aggregate.shots.length <= 1 ||
    input.aggregate.document.items.length <= 1
  ) {
    return {
      status: "error",
      error: "last-shot",
      message: "最后一个镜头不能删除",
    };
  }
  const shotIndex = input.aggregate.shots.findIndex(
    shot => storyIdentity(shot) === input.stableShotId
  );
  if (shotIndex < 0)
    return {
      status: "error",
      error: "shot-not-found",
      message: "故事中找不到这个镜头",
    };
  const base = materializeAbsolutePlacements(input.aggregate.document);
  const removedItem = base.items.find(
    item => item.stableShotId === input.stableShotId
  );
  if (!removedItem)
    return {
      status: "error",
      error: "timeline-item-not-found",
      message: "时间线中找不到这个镜头",
    };
  let document: VisualEditDocument = {
    ...base,
    items: base.items.filter(item => item.stableShotId !== input.stableShotId),
  };
  for (const clip of removedItem.imageClips ?? []) {
    const startFrame = clip.timelineStartFrame ?? 0;
    const hostId = selectImageClipHostForFrame(document, startFrame);
    if (!hostId)
      return {
        status: "error",
        error: "last-shot",
        message: "没有可接收独立图片的剩余镜头",
      };
    const hostStart =
      document.items.find(item => item.stableShotId === hostId)
        ?.timelineStartFrame ?? 0;
    document = {
      ...document,
      items: document.items.map(item =>
        item.stableShotId === hostId
          ? {
              ...item,
              imageClips: [
                ...(item.imageClips ?? []),
                {
                  ...clip,
                  timelineStartFrame: startFrame,
                  offsetFrames: Math.max(0, startFrame - hostStart),
                },
              ],
            }
          : item
      ),
    };
  }
  const shots = input.aggregate.shots
    .filter((_, index) => index !== shotIndex)
    .map((shot, index) => ({ ...shot, shotNo: index + 1 }));
  document = {
    ...document,
    items: document.items
      .slice()
      .sort((left, right) => left.position - right.position)
      .map((item, position) => ({ ...item, position })),
  };
  return { status: "ok", aggregate: { shots, document } };
}

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
