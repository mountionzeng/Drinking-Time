export type SelectionSourceType =
  | "card"
  | "script-scene"
  | "script-meta"
  | "shot"
  | "storyboard-image"
  | "animatic-video"
  | "timeline-range"
  | "chat";

export type SelectionContext = {
  sourceType: SelectionSourceType;
  sourceId: string;
  selectedText: string;
  fullText: string;
  storyId?: number | null;
  stableShotId?: string | null;
  shotNo?: number | null;
  imageId?: number | null;
  videoTakeId?: number | null;
  rangeId?: number | null;
};
