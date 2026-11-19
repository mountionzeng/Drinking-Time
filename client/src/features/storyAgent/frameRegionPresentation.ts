import type { ChatFrameReference } from "@shared/chatFrameReference";
import type { FrameRegionReview, FrameRegionTask } from "@shared/frameRegionReview";
import { TIMELINE_FPS } from "@shared/timelineViewport";

export function frameLocationLabel(frame: ChatFrameReference, en: boolean) {
  if (frame.origin === "warehouse-video") return en ? `Source video ${frame.sourceTimeSec.toFixed(2)}s · Take ${frame.takeId}` : `源视频 ${frame.sourceTimeSec.toFixed(2)}s · Take ${frame.takeId}`;
  return en
    ? `In shot ${frame.shotTimeSec.toFixed(2)}s · Timeline ${((frame.timelineFrame ?? 0) / TIMELINE_FPS).toFixed(2)}s`
    : `镜内 ${frame.shotTimeSec.toFixed(2)}s · 全片 ${((frame.timelineFrame ?? 0) / TIMELINE_FPS).toFixed(2)}s`;
}

/** Use saved frame provenance, never the live playhead, for an existing image. */
export function findReviewImageFrame(reviews: FrameRegionReview[], storyId: number | null, stableShotId: string, imageId: number) {
  const matching = reviews.filter(review => review.storyId === storyId && review.stableShotId === stableShotId)
    .sort((a, b) => b.updatedAt - a.updatedAt || b.revision - a.revision);
  for (const review of matching) {
    const frameId = review.frames.some(frame => frame.imageId === imageId) ? imageId
      : review.tasks.find(task => task.candidate?.imageId === imageId || task.shapeQuote?.sourceImageId === imageId)?.imageId;
    const frame = review.frames.find(frame => frame.imageId === frameId && frame.storyId === storyId && frame.stableShotId === stableShotId);
    if (frame) return frame;
  }
  return undefined;
}

/** Describe recorded processing parameters, not an inferred visual success. */
export function regionTreatmentLabel(task: FrameRegionTask, en: boolean): string | undefined {
  if (task.target === "forest") {
    if (task.forestTone === "harmonize_green_less_blue") return en ? "Harmonize canopy greens with less blue in shadows; retain light and shade" : "协调树冠绿色，阴影减少蓝色，保留明暗层次";
    if (task.forestTone === "harmonize_green") return en ? "Harmonize tree-canopy greens, retaining light and shade" : "协调树冠绿色，保留明暗层次";
    if (task.forestTone === "reduce_green_flatness") return en ? "Reduce excessive green, retaining tonal layers" : "降低过强绿感，保留颜色层次";
  }
  return undefined;
}
