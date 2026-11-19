import { buildTimelineLayout } from "../../shared/timelineLayout";
import {
  DEFAULT_TIMELINE_VIDEO_EFFECTS, STORY_TIMELINE_FPS, withTimelineDurationMs,
} from "../../shared/storyMaterial";
import {
  loadOwnedStoryVisualAggregate, saveStoryVisualTimelineCas, visualDocumentFromTimeline,
} from "../persistence/storyVisualPersistence";

/** Called inside the story visual-edit lock. The timeline owns this edit, including its history. */
export async function placeFirstReviewTake(input: {
  storyId: number; userId: number; stableShotId: string; takeId: number; expectedVersion: number;
}) {
  const aggregate = await loadOwnedStoryVisualAggregate({ ...input, includeVideoTakes: true });
  const timeline = aggregate?.timeline;
  const take = aggregate?.videoTakes.find(row => row.id === input.takeId && row.stableShotId === input.stableShotId);
  if (!timeline || take?.status !== "available" || !take.videoUrl || !take.durationSec || take.durationSec <= 0 || !Number.isFinite(take.durationSec))
    throw new Error("镜头或视频已不可用，请重新打开候选。");
  const document = visualDocumentFromTimeline(timeline);
  if (!document) throw new Error("请先把这个镜头加入剪辑线。");
  const rows = buildTimelineLayout(document.items);
  const matches = rows.filter(row => row.item.stableShotId === input.stableShotId);
  const row = matches[0];
  if (matches.length !== 1 || !row.item.included || row.item.visualClipsReplacePrimary)
    throw new Error("当前镜头没有可用的主画面位置。");
  const primary = row.item.primaryVideoEdit;
  if (primary?.takeId === take.id) return;
  if (primary || timeline.version !== input.expectedVersion)
    throw new Error("剪辑位置已更新，请核对当前版本后再保存。");

  // An extended placeholder may use the following gap, but may not ripple an
  // unpinned shot or cover another shot on the same layer.
  const layer = row.item.visualLayer ?? 0;
  const hasImplicitFollower = rows.some(other => other.item.position > row.item.position && other.item.timelineStartFrame == null);
  const nextStart = Math.min(Infinity, ...rows.filter(other =>
    other !== row && other.item.included && (other.item.visualLayer ?? 0) === layer && other.endFrame > row.startFrame
  ).map(other => other.startFrame));
  const room = hasImplicitFollower ? row.durationFrames : Math.max(row.durationFrames, nextStart - row.startFrame);
  const length = Math.min(Math.max(1, Math.round(take.durationSec * STORY_TIMELINE_FPS)), room);
  const sourceEndSec = Math.min(take.durationSec, length / STORY_TIMELINE_FPS);
  const placed = {
    ...withTimelineDurationMs(row.item, Math.max(row.durationFrames, length) * 1000 / STORY_TIMELINE_FPS),
    primaryVideoEdit: { takeId: take.id, sourceStartSec: 0, sourceEndSec, effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS } },
  };
  await saveStoryVisualTimelineCas({ ...input, expectedVersion: timeline.version, document: {
    ...document, items: document.items.map(item => item === row.item ? placed : item),
  } });
}
