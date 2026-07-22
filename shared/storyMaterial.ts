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

export type StoryTimelineItem = {
  stableShotId: string;
  included: boolean;
  position: number;
  plannedDurationMs: number;
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
