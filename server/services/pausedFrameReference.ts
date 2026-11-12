import type { PausedFrameSnapshot } from "../../shared/chatFrameReference";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  type StoryMaterialState,
  type TimelineTransform,
} from "../../shared/storyMaterial";
import { buildTimelineLayout } from "../../shared/timelineLayout";
import {
  resolveTimelineFrameExtraction,
  type CurrentTimelineVideo,
} from "./timelineFrameExtraction";

/** Resolve the visible source, including hidden layers, trimming, speed and reverse. */
export function planPausedFrame(
  state: StoryMaterialState,
  snapshot: PausedFrameSnapshot
) {
  if (
    state.storyId !== snapshot.storyId ||
    state.timeline.version !== snapshot.timelineVersion
  )
    throw new Error(
      "剪辑版本已变化，请重新引用当前帧 / Timeline changed; reference the current frame again"
    );
  const currentVideos = new Map<string, CurrentTimelineVideo>();
  for (const shot of state.shots) {
    const video = shot.currentVideo;
    if (!video) continue;
    const range =
      video.selectedSelectionType === "range"
        ? video.ranges.find(r => r.id === video.selectedRangeId)
        : undefined;
    currentVideos.set(shot.stableShotId, {
      takeId: video.id,
      durationSec: video.durationSec,
      rangeId: range?.id,
      sourceStartSec: range?.startSec ?? 0,
      sourceEndSec: range?.endSec ?? video.durationSec ?? undefined,
    });
  }
  const resolved = resolveTimelineFrameExtraction({
    document: state.timeline,
    timelineFrame: snapshot.timelineFrame,
    hiddenVisualLayers: snapshot.hiddenVisualLayers,
    currentVideosByShot: currentVideos,
  });
  if (resolved.status !== "ok")
    throw new Error("这里没有可读取的画面 / No readable picture at this frame");
  const descriptor = resolved.descriptor;
  const shot = state.shots.find(
    s => s.stableShotId === descriptor.ownerStableShotId
  );
  if (!shot) throw new Error("画面所属镜头已不存在 / Source shot unavailable");
  const row = buildTimelineLayout(state.timeline.items).find(
    r => r.item.stableShotId === shot.stableShotId
  );
  let transform: TimelineTransform =
    row?.item.transform ?? DEFAULT_TIMELINE_TRANSFORM;
  if (descriptor.kind === "image") {
    transform =
      row?.item.imageClips?.find(c => c.id === descriptor.clipId)?.transform ??
      DEFAULT_TIMELINE_TRANSFORM;
  } else {
    const takes = [
      ...state.shots.flatMap(s => s.videoTakes),
      ...state.reusableVideoTakes,
      ...state.unassignedVideoTakes,
    ];
    const take = takes.find(
      t =>
        t.id === descriptor.takeId &&
        t.storyId === state.storyId &&
        t.status === "available"
    );
    if (!take) throw new Error("原视频不可用 / Source video unavailable");
    const overlay = state.timeline.overlays?.find(
      o => o.id === descriptor.sourceClipId
    );
    const clip = row?.item.visualClips?.find(
      c => c.id === descriptor.sourceClipId
    );
    transform = overlay?.transform ?? clip?.transform ?? transform;
    const effects =
      overlay?.effects ?? clip?.effects ?? row?.item.primaryVideoEdit?.effects;
    // A wall-clock CSS animation has no deterministic paused phase. Never pretend a raw frame includes it.
    if (effects?.motionPreset)
      throw new Error(
        "请先关闭动态预览效果再引用这一帧 / Disable animated preview effects before referencing this frame"
      );
  }
  const scale = Math.min(1, 1280 / Math.max(snapshot.width, snapshot.height));
  return {
    shot,
    descriptor,
    offset: Math.max(0, snapshot.timelineFrame - (row?.startFrame ?? 0)),
    transform,
    dimensions: {
      width: Math.max(1, Math.round(snapshot.width * scale)),
      height: Math.max(1, Math.round(snapshot.height * scale)),
    },
  };
}
