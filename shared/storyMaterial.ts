import type { ImageAsset } from "./imageAsset";
import type { VideoTakeAsset } from "./videoAsset";

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
};

export const STORY_TIMELINE_FPS = 30;

export function timelineMsToFrames(valueMs: number): number {
  if (!Number.isFinite(valueMs)) return 1;
  return Math.max(1, Math.round((valueMs * STORY_TIMELINE_FPS) / 1000));
}

export function timelineFramesToMs(frames: number): number {
  if (!Number.isFinite(frames)) return 0;
  return Math.round((Math.max(0, Math.round(frames)) * 1000) / STORY_TIMELINE_FPS);
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
  anchors?: StoryTimelineAnchor[];
  transform: TimelineTransform;
  primaryVideoEdit?: StoryTimelinePrimaryVideoEdit;
  visualClips?: StoryTimelineVisualClip[];
  visualClipsReplacePrimary?: boolean;
};

export type TimelineDocument = {
  storyId: number;
  version: number;
  items: StoryTimelineItem[];
};

export type ShotMaterialState = {
  stableShotId: string;
  shotNo: number;
  cueCode?: string | null;
  currentImage: ImageAsset | null;
  imageVersions: ImageAsset[];
  currentVideo: VideoTakeAsset | null;
  videoTakes: VideoTakeAsset[];
  timelineItem: StoryTimelineItem | null;
};

export type StoryMaterialState = {
  storyId: number;
  timeline: TimelineDocument;
  shots: ShotMaterialState[];
  unassignedImages: ImageAsset[];
  unassignedVideoTakes: VideoTakeAsset[];
  reusableVideoTakes: VideoTakeAsset[];
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
