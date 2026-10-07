import { buildTimelineLayout } from "./timelineLayout";
import { timelineImageClipStartFrame } from "./storyMaterial";
import {
  insertVisualImageClip,
  projectVisualClips,
  parseVisualTrackId,
  visualTrackId,
  type VisualEditDocument,
} from "./visualClipModel";

/** Revisions are independent clips. Never promote or replace the source asset. */
export function placeImageRevision(
  document: VisualEditDocument,
  input: {
    sourceImageId: number;
    stableShotId: string;
    imageId: number;
    imageUrl: string;
  }
) {
  const clipId = `image-revision-${input.imageId}`;
  if (
    document.items.some(item =>
      item.imageClips?.some(clip => clip.id === clipId)
    )
  ) {
    return { status: "ok" as const, document, changed: false };
  }
  const rows = buildTimelineLayout(document.items);
  const matches = rows.flatMap(row =>
    (row.item.imageClips ?? [])
      .filter(clip => clip.imageId === input.sourceImageId)
      .map(clip => ({
        startFrame: timelineImageClipStartFrame(clip, row.startFrame),
        durationFrames: clip.durationFrames,
        layer: clip.visualLayer ?? 1,
        transform: clip.transform,
      }))
  );
  if (matches.length > 1)
    return {
      status: "error" as const,
      message: "原图在时间线上有多个位置，请从仓库拖入新图",
    };
  const row = rows.find(row => row.item.stableShotId === input.stableShotId);
  const source =
    matches[0] ??
    (row
      ? {
          startFrame: row.startFrame,
          durationFrames: row.durationFrames,
          layer: row.item.visualLayer ?? 0,
          transform: row.item.transform,
        }
      : null);
  if (!source)
    return {
      status: "error" as const,
      message: "原镜头已离开时间线，新图已保存在仓库",
    };
  const overlapping = projectVisualClips(document).filter(
    clip =>
      clip.startFrame < source.startFrame + source.durationFrames &&
      clip.startFrame + clip.durationFrames > source.startFrame
  );
  let layer =
    Math.max(
      source.layer,
      ...overlapping.map(clip => parseVisualTrackId(clip.trackId) ?? 0)
    ) + 1;
  const hidden = new Set(document.visualLayerState?.hidden ?? []);
  while (hidden.has(layer)) layer += 1;
  return insertVisualImageClip(document, {
    clipId,
    imageId: input.imageId,
    imageUrl: input.imageUrl,
    label: "改图",
    trackId: visualTrackId(layer),
    startFrame: source.startFrame,
    durationFrames: source.durationFrames,
    transform: source.transform,
  });
}
