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
};

export type StoryTimelineItem = {
  stableShotId: string;
  included: boolean;
  position: number;
  plannedDurationMs: number;
  transform: TimelineTransform;
};

export type TimelineDocument = {
  storyId: number;
  version: number;
  items: StoryTimelineItem[];
};

export type ShotMaterialState = {
  stableShotId: string;
  shotNo: number;
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
};

export const DEFAULT_TIMELINE_TRANSFORM: TimelineTransform = {
  cropX: 0,
  cropY: 0,
  cropWidth: 1,
  cropHeight: 1,
  zoom: 1,
  panX: 0,
  panY: 0,
};
