import type { ImageAsset } from "./imageAsset";
import type { PublishingAlbumTypographyLayout } from "./publishingAlbum";
import type { VideoTakeAsset } from "./videoAsset";
import type {
  ShotVisualAssetBinding,
  ShotVisualAssetBindingProposal,
  StoryVisualAsset,
} from "./visualAssets";

export type TimelineTransform = {
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  zoom: number;
  panX: number;
  panY: number;
  rotationDeg?: number;
  flipX?: boolean;
  flipY?: boolean;
};

/** Editable product text attached to one storyboard image, never burned into source pixels. */
export type StoryTimelineImageTextOverlay = {
  text: string;
  typography: PublishingAlbumTypographyLayout;
};

export type TimelineVideoEffects = {
  playbackRate: number;
  reverse: boolean;
  volume: number;
  muted: boolean;
  /** 可撤销的时间性画面效果；不改变源视频。 */
  motionPreset?: TimelineMotionPreset | null;
};

export type TimelineMotionPreset = {
  kind: "heartbeat";
  /** 每分钟脉冲次数。 */
  bpm: number;
  /** 单次脉冲的最大缩放幅度，例如 0.06 表示 6%。 */
  scaleAmount: number;
};

export type StoryTimelinePrimaryVideoEdit = {
  takeId: number;
  sourceStartSec: number;
  sourceEndSec: number;
  effects: TimelineVideoEffects;
};

export type StoryTimelineVisualClip = {
  id: string;
  takeId: number;
  rangeId: number;
  sourceStableShotId: string;
  videoUrl: string;
  label: string;
  sourceStartSec: number;
  sourceEndSec: number;
  offsetMs: number;
  durationMs: number;
  effects?: TimelineVideoEffects;
  transform?: TimelineTransform;
  /** 0 is the primary visual layer; larger values render above it. */
  visualLayer?: number;
};

export type StoryTimelineImageClip = {
  id: string;
  imageId: number;
  imageUrl: string;
  label: string;
  /** Placement relative to the owning timeline item. */
  offsetFrames: number;
  /**
   * Canonical absolute placement. Once present, moving the owning video must
   * not move this independent image clip. Legacy clips fall back to offsetFrames.
   */
  timelineStartFrame?: number;
  /** Extracted stills default to exactly one structural frame. */
  durationFrames: number;
  /** 0 is the primary visual layer; larger values render above it. */
  visualLayer: number;
  transform?: TimelineTransform;
};

export function timelineImageClipStartFrame(
  clip: Pick<StoryTimelineImageClip, "offsetFrames" | "timelineStartFrame">,
  ownerStartFrame: number
): number {
  return Math.max(
    0,
    Math.round(clip.timelineStartFrame ?? ownerStartFrame + clip.offsetFrames)
  );
}

export const STORY_TIMELINE_FPS = 30;

/**
 * Convert a structural *duration* to frames. A visible duration is never
 * shorter than one frame, so the result is clamped to at least 1.
 */
export function timelineMsToFrames(valueMs: number): number {
  if (!Number.isFinite(valueMs)) return 1;
  return Math.max(1, Math.round((valueMs * STORY_TIMELINE_FPS) / 1000));
}

/**
 * Convert a *position* (absolute start or intra-shot offset) to frames.
 * Unlike a duration, zero is a legitimate value and must survive the
 * conversion, otherwise a clip pinned to the head of its shot drifts a frame.
 */
export function timelineOffsetMsToFrames(valueMs: number): number {
  if (!Number.isFinite(valueMs)) return 0;
  return Math.max(0, Math.round((valueMs * STORY_TIMELINE_FPS) / 1000));
}

export function timelineFramesToMs(frames: number): number {
  if (!Number.isFinite(frames)) return 0;
  return Math.round(
    (Math.max(0, Math.round(frames)) * 1000) / STORY_TIMELINE_FPS
  );
}

/**
 * Change a shot's duration on both representations at once.
 *
 * Frames are the canonical structural truth and milliseconds are their
 * projection, so a writer that only sets `plannedDurationMs` leaves a stale
 * `durationFrames` behind — and the stale value silently wins in layout, which
 * looks to the user like the edit snapped back.
 */
export function withTimelineDurationMs<
  T extends { plannedDurationMs: number; durationFrames?: number },
>(item: T, durationMs: number): T {
  const plannedDurationMs = Math.max(100, Math.round(durationMs));
  return {
    ...item,
    plannedDurationMs,
    durationFrames: timelineMsToFrames(plannedDurationMs),
  };
}

export type StoryTimelineAnchor = {
  id: string;
  timelineFrame: number;
  sourceType: "primary-video" | "visual-clip" | "image";
  sourceId: string;
  sourceTimeSec: number | null;
};

export type StoryTimelineItem = {
  stableShotId: string;
  included: boolean;
  position: number;
  plannedDurationMs: number;
  /** Canonical structural duration on the 30 fps timeline. */
  durationFrames?: number;
  /** Canonical absolute start on the 30 fps timeline. */
  timelineStartFrame?: number;
  /** Durable overlap priority; larger values win among unanchored items. */
  stackOrder?: number;
  /** Persistent NLE layer. 0 is the main visual layer; larger values are above it. */
  visualLayer?: number;
  /**
   * Non-owning reference to an existing story image used as this shot's
   * primary visual. The source image keeps its original shot identity.
   */
  referencedImageId?: number;
  /**
   * Explicitly keeps this shot detached from the named shot immediately to
   * its left. The id (rather than a boolean "previous") prevents a reorder
   * from accidentally carrying the opt-out to a different neighbour.
   */
  detachedFromPreviousShotId?: string;
  anchors?: StoryTimelineAnchor[];
  transform: TimelineTransform;
  /** Per-storyboard-frame transforms. The legacy item transform remains the fallback. */
  imageTransforms?: Record<string, TimelineTransform>;
  /** Per-storyboard-frame editable text. Other images remain untouched. */
  imageTextOverlays?: Record<string, StoryTimelineImageTextOverlay>;
  primaryVideoEdit?: StoryTimelinePrimaryVideoEdit;
  visualClips?: StoryTimelineVisualClip[];
  imageClips?: StoryTimelineImageClip[];
  visualClipsReplacePrimary?: boolean;
};

export type StoryTimelineOverlay = {
  id: string;
  kind: "generated-video";
  takeId: number;
  sourceStableShotId: string;
  videoUrl: string;
  /** Absolute 30 fps placement of the generated media. */
  startFrame: number;
  /** The second extracted frame. A shorter generated video leaves a gap until here. */
  targetEndFrame: number;
  /** Actual complete media end; it may extend slightly past targetEndFrame. */
  mediaEndFrame: number;
  /** max(targetEndFrame, mediaEndFrame), so the uncovered tail remains an explicit gap. */
  endFrame: number;
  stackOrder: number;
  /**
   * 兼容图层。历史 overlay 没有这个字段，解析时按写死的上层 1 处理；一旦图层被
   * 插入、删除或整层排序，这里会被一起重编号，overlay 不会停在错误的层上。
   */
  visualLayer?: number;
  leftImageId: number;
  rightImageId: number;
  transform: TimelineTransform;
  effects?: TimelineVideoEffects;
};

/**
 * Persistent management state for ordinary visual layers. Layers are indexed bottom-up.
 *
 * `count` 只记「用户明确建出来的层数」。最高那一层空白投放层是**派生**的，不写进
 * 数据库——否则把素材拖上顶层会让 count 永久 +1，再拖回来也退不掉，空层越攒越多。
 * 渲染要用的层数一律走 `resolveTimelineVisualLayerState().count`。
 */
export type StoryTimelineVisualLayerState = {
  /** Explicitly created layers, including the primary layer at index 0. */
  count: number;
  /** Hidden layers do not participate in preview or export resolution. */
  hidden: number[];
};

/**
 * Forward-compatible slot for timeline media the visual model does not own.
 * Subtitles land here in U3, audio tracks in U9. U1 defines only the carrier:
 * every codec, writer, aggregate save and undo path must round-trip unknown
 * keys here byte-for-byte, so a visual-only save can never drop a subtitle or
 * audio slice. Absent whenever the stored document has no non-visual slice.
 *
 * Keys are namespaced slices (e.g. `subtitleTracks`, `audioTracks`), each
 * merged independently on write — a writer that sets one slice leaves the
 * others untouched.
 */
export type TimelineDocumentExtensions = {
  [slice: string]: unknown;
};

export type TimelineDocument = {
  storyId: number;
  version: number;
  items: StoryTimelineItem[];
  overlays?: StoryTimelineOverlay[];
  visualLayerState?: StoryTimelineVisualLayerState;
  /** Non-visual media slices. See {@link TimelineDocumentExtensions}. */
  extensions?: TimelineDocumentExtensions;
};

export type ShotMaterialState = {
  stableShotId: string;
  shotNo: number;
  cueCode?: string | null;
  currentImage: ImageAsset | null;
  imageVersions: ImageAsset[];
  /**
   * Existing story images used by, or derived from inputs to, this shot.
   * They remain owned by their original shot and must not become current here
   * merely because the relationship is projected for editing and provenance.
   */
  relatedImages?: ImageAsset[];
  currentVideo: VideoTakeAsset | null;
  videoTakes: VideoTakeAsset[];
  timelineItem: StoryTimelineItem | null;
  visualAssetBinding?: ShotVisualAssetBinding | null;
};

export type StoryVisualAssetMaterialState = {
  assets: StoryVisualAsset[];
  proposals: ShotVisualAssetBindingProposal[];
  bindings: ShotVisualAssetBinding[];
  images: ImageAsset[];
};

export type StoryMaterialState = {
  storyId: number;
  timeline: TimelineDocument;
  shots: ShotMaterialState[];
  unassignedImages: ImageAsset[];
  unassignedVideoTakes: VideoTakeAsset[];
  reusableVideoTakes: VideoTakeAsset[];
  visualAssets?: StoryVisualAssetMaterialState;
};

export const DEFAULT_TIMELINE_TRANSFORM: TimelineTransform = {
  cropX: 0,
  cropY: 0,
  cropWidth: 1,
  cropHeight: 1,
  zoom: 1,
  panX: 0,
  panY: 0,
  rotationDeg: 0,
  flipX: false,
  flipY: false,
};

export const DEFAULT_TIMELINE_VIDEO_EFFECTS: TimelineVideoEffects = {
  playbackRate: 1,
  reverse: false,
  volume: 1,
  muted: false,
};
