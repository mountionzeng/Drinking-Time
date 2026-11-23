import type { StoryTimelineItem, StoryTimelineOverlay } from "@shared/storyMaterial";
import { timelineFramesToMs } from "@shared/storyMaterial";
import { buildTimelineLayout } from "@shared/timelineLayout";
import type { TimelineVideoSource } from "./previewPlaybackModel";

// Check only instants at which the underlying video can change. Images stay on
// their existing layer, independently of the two video decoders underneath.
export function previewVideoBoundaries(
  items: readonly StoryTimelineItem[],
  overlays: readonly StoryTimelineOverlay[],
) {
  const times = new Set<number>();
  for (const row of buildTimelineLayout(items)) {
    const start = timelineFramesToMs(row.startFrame);
    times.add(start);
    times.add(timelineFramesToMs(row.endFrame));
    for (const clip of row.item.visualClips ?? []) {
      times.add(start + clip.offsetMs);
      times.add(start + clip.offsetMs + clip.durationMs);
    }
  }
  for (const overlay of overlays) {
    for (const frame of [overlay.startFrame, overlay.mediaEndFrame, overlay.endFrame]) {
      times.add(timelineFramesToMs(frame));
    }
  }
  return [...times].sort((a, b) => a - b);
}

export function previewVideoKey(source: TimelineVideoSource) {
  return JSON.stringify([source.stableShotId, source.overlayId, source.existingClipId, source.videoUrl]);
}

export function nextPreviewVideo(
  boundaries: readonly number[], nextIndex: number, currentKey: string | null,
  resolve: (timeMs: number) => TimelineVideoSource | null,
) {
  if (nextIndex < 0 || !currentKey) return null;
  for (let i = nextIndex; i < boundaries.length; i++) {
    const next = resolve(boundaries[i]);
    if (!next || previewVideoKey(next) !== currentKey) return next;
  }
  return null;
}

export function prepareStandbyVideo(video: HTMLVideoElement, sourceTime: number) {
  video.muted = true;
  if (!video.paused) video.pause();
  if (video.readyState < 1 || !Number.isFinite(video.duration)) return;
  const time = Math.min(sourceTime, Math.max(0, video.duration - 0.001));
  if (Math.abs(video.currentTime - time) > 0.004) video.currentTime = time;
}

export function holdOutgoingVideo(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  if (video.readyState < 2 || !video.videoWidth || !canvas.hidden) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  try {
    context.drawImage(video, 0, 0);
    canvas.style.transform = video.style.transform;
    canvas.hidden = false;
  } catch {
    // A decoder may have already released its last frame on removal.
    canvas.hidden = true;
  }
}
