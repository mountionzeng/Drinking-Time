import { shotIdentityFromShot } from "../../shared/shotIdentity";
import { restoreStoryShotAtIndex } from "../../shared/storyShotEditing";
import { DEFAULT_TIMELINE_TRANSFORM, DEFAULT_TIMELINE_VIDEO_EFFECTS, STORY_TIMELINE_FPS, timelineFramesToMs } from "../../shared/storyMaterial";
import { buildTimelineLayout } from "../../shared/timelineLayout";
import { projectVisualClips, visualTrackId } from "../../shared/visualClipModel";
import { loadOwnedStoryVisualAggregate, saveStoryVisualAggregateCas, saveStoryVisualTimelineCas, visualDocumentFromTimeline } from "../persistence/storyVisualPersistence";
import { replacePrimaryTake } from "../repositories/replacePrimaryTake";
import { placeFirstReviewTake } from "./placeFirstReviewTake";
import { projectStoryTimelineDocument } from "./storyMaterials";
import { getStoryRevision, prepareStoryBody } from "./storySync";

type Save = {
  storyId: number; userId: number; stableShotId: string; takeId: number;
  expectedVersion: number; expectedTakeId: number | null;
};

/** A chat save uses the complete reviewed cut. Strict trim-preserving swaps still have their own command. */
export async function saveReviewedTake(input: Save) {
  const aggregate = await loadOwnedStoryVisualAggregate({ ...input, includeVideoTakes: true });
  const timeline = aggregate?.timeline;
  const take = aggregate?.videoTakes.find(t => t.id === input.takeId && t.stableShotId === input.stableShotId);
  if (!aggregate || !timeline || take?.status !== "available" || !take.videoUrl || !take.durationSec || !Number.isFinite(take.durationSec) || take.durationSec <= 0)
    throw new Error("镜头或候选视频已不可用，请重新打开。");
  const document = visualDocumentFromTimeline(timeline);
  if (!document) throw new Error("请先把镜头加入剪辑线。");
  const body = aggregate.story.body as Record<string, unknown>;
  const shots: Record<string, unknown>[] = Array.isArray(body?.shots) ? body.shots : [];
  const index = shots.findIndex((shot, i) => shotIdentityFromShot(shot, i) === input.stableShotId);
  const raw = document.items.find(item => item.stableShotId === input.stableShotId);
  if (index < 0 || !raw?.included || raw.visualClipsReplacePrimary)
    throw new Error("当前镜头没有可用的剪辑位置。");

  const projected = projectStoryTimelineDocument(aggregate.story, timeline);
  const rows = buildTimelineLayout(projected.items);
  const row = rows.find(r => r.item.stableShotId === input.stableShotId)!;
  const slotLayer = row.item.visualLayer ?? 0;
  const primary = raw.primaryVideoEdit;
  const clipId = "review-take-" + take.id;
  const savedRow = rows.find(r => r.item.stableShotId === clipId);
  const savedIndex = shots.findIndex((shot, i) => shotIdentityFromShot(shot, i) === clipId);
  function receipt(stableShotId: string, shotNo: number, layer: number, startFrame: number, revision: number, inserted: Record<string, unknown> | null) {
    return { stableShotId, shotNo, layer, startFrame, revision, inserted, takeId: input.takeId };
  }
  if (savedRow || savedIndex >= 0) {
    if (savedRow?.item.primaryVideoEdit?.takeId !== take.id || !savedRow.item.included || savedIndex < 0)
      throw new Error("已保存的剪辑位置发生变化，请核对时间线。");
    return receipt(clipId, savedIndex + 1, savedRow.item.visualLayer ?? 0, savedRow.startFrame, getStoryRevision(body), shots[savedIndex]);
  }
  const current = () => receipt(input.stableShotId, Number(shots[index].shotNo ?? index + 1), slotLayer, row.startFrame, getStoryRevision(body), null);
  if (primary?.takeId === take.id) return current();
  if (timeline.version !== input.expectedVersion || (primary?.takeId ?? null) !== input.expectedTakeId)
    throw new Error("剪辑位置已更新，请核对当前版本后再保存。");
  const length = Math.max(1, Math.round(take.durationSec * STORY_TIMELINE_FPS));
  const fullSourceFitsTrim = primary && primary.sourceStartSec === 0 && row.durationFrames === length && primary.effects.playbackRate === 1 &&
    Math.round(primary.sourceEndSec * STORY_TIMELINE_FPS) === length && primary.sourceEndSec <= take.durationSec + 0.001;
  if (primary && fullSourceFitsTrim) {
    await replacePrimaryTake({ ...input, expectedTakeId: primary.takeId });
    return current();
  }
  const clips = projectVisualClips(projected);
  const overlaps = (start: number, layer: number, skip?: string) => clips.some(c =>
    c.id !== skip && c.trackId === visualTrackId(layer) && c.startFrame < start + length && c.startFrame + c.durationFrames > start);
  const starts = new Map(rows.map(r => [r.item.stableShotId, r.startFrame]));
  if (!primary && length < row.durationFrames) {
    await saveStoryVisualTimelineCas({ ...input, document: { ...document, items: document.items.map(i => {
      const fixed = i.timelineStartFrame == null ? { ...i, timelineStartFrame:starts.get(i.stableShotId) } : i;
      return i !== raw ? fixed : { ...fixed, durationFrames:length, plannedDurationMs:timelineFramesToMs(length),
        primaryVideoEdit:{takeId:take.id,sourceStartSec:0,sourceEndSec:take.durationSec!,effects:{...DEFAULT_TIMELINE_VIDEO_EFFECTS}} };
    }) } });
    return current();
  }
  if (!primary) {
    const implicitFollower = document.items.some(i => i.position > raw.position && i.timelineStartFrame == null);
    if (length <= row.durationFrames || (!implicitFollower && !overlaps(row.startFrame, slotLayer, "shot:" + input.stableShotId))) {
      await placeFirstReviewTake(input);
      return current();
    }
  }

  // Keep existing edit blocks and ranges intact. A gap immediately before the target
  // joins the previous shot; a parallel block starts on a visible, unoccupied layer.
  const previousId = index > 0 ? shotIdentityFromShot(shots[index-1], index-1) : null;
  const previous = rows.find(r => r.item.stableShotId === previousId && r.item.included);
  const start = previous && previous.endFrame < row.startFrame ? previous.endFrame : row.startFrame;
  let layer = slotLayer;
  const hidden = new Set(document.visualLayerState?.hidden ?? []);
  while (hidden.has(layer) || overlaps(start, layer)) layer++;

  const durationMs = timelineFramesToMs(length);
  const newShot = { stableShotId: clipId, shotIdentity: clipId, shotKey: `SH${String(index + 1).padStart(2, "0")}`, subject: "视频 Take #" + take.id,
    sceneNo: shots[index].sceneNo, sceneTitle: shots[index].sceneTitle, durationSec: take.durationSec,
    durationMs, shotNo: index + 1 };
  const nextShots = restoreStoryShotAtIndex(shots, newShot, index).shots;
  const storyRevision = getStoryRevision(body);
  const items = document.items.slice().sort((a,b) => a.position-b.position)
    .map(i => i.timelineStartFrame == null ? { ...i, timelineStartFrame: starts.get(i.stableShotId) } : i);
  items.splice(items.findIndex(i => i.stableShotId === input.stableShotId), 0, {
    stableShotId: clipId, timelineStartFrame: start, durationFrames: length, plannedDurationMs: durationMs,
    visualLayer: layer, included: true, position: raw.position,
    transform: { ...DEFAULT_TIMELINE_TRANSFORM },
    primaryVideoEdit: { takeId: take.id, sourceStartSec: 0, sourceEndSec: take.durationSec, effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS } },
  });
  await saveStoryVisualAggregateCas({
    ...input, expectedStoryRevision: storyRevision, expectedTimelineVersion: timeline.version,
    nextStoryBody: prepareStoryBody({ ...body, shots: nextShots }, storyRevision + 1, body),
    nextDocument: { ...document, items: items.map((item, position) => ({ ...item, position })) },
  });
  return receipt(clipId, index + 1, layer, start, storyRevision + 1, newShot);
}
