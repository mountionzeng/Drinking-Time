import { and, eq } from "drizzle-orm";
import {
  stories,
  storyTimelines,
  videoTakes,
  videoTakeRanges,
  videoTimelineSelections,
  type StoryTimeline,
  type VideoTake,
  type VideoTimelineSelection,
} from "../../drizzle/schema";
import type { StoryTimelineItem } from "../../shared/storyMaterial";
import { appendVideoEditRevision } from "../persistence/videoEditHistory";
import {
  decodeStoryTimelinePayload,
  encodeStoryTimelinePayload,
} from "./timelineCodec";
import {
  ensureMemoryLoaded,
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
  withLocalAggregateMutationLock,
  withLocalStoryLock,
  withLocalTimelineLock,
} from "./runtime";

type Swap = {
  storyId: number;
  userId: number;
  stableShotId: string;
  takeId: number;
  expectedTakeId: number;
  expectedVersion: number;
};

function prepare(
  input: Swap,
  timeline: StoryTimeline | undefined,
  body: unknown,
  take: VideoTake | undefined,
  selection: VideoTimelineSelection | undefined
) {
  if (
    !body ||
    !timeline ||
    !take ||
    take.storyId !== input.storyId ||
    take.userId !== input.userId ||
    take.stableShotId !== input.stableShotId ||
    take.status !== "available" ||
    !take.videoUrl
  )
    throw new Error("镜头或候选已不可用，请重新选择。");
  const stored = decodeStoryTimelinePayload(timeline.items);
  const items: StoryTimelineItem[] = Array.isArray(stored.items)
    ? stored.items
    : [];
  const matches = items.filter(
    item => item.stableShotId === input.stableShotId
  );
  const item = matches[0],
    primary = item?.primaryVideoEdit;
  if (
    matches.length !== 1 ||
    !item.included ||
    !primary ||
    item.visualClipsReplacePrimary
  )
    throw new Error("当前镜头没有唯一的主视频片段。");
  if (primary.takeId === take.id && selection?.takeId === take.id) return null;
  if (
    timeline.version !== input.expectedVersion ||
    primary.takeId !== input.expectedTakeId ||
    (selection && selection.takeId !== primary.takeId)
  )
    throw new Error("剪辑位置已更新，请核对当前版本后再替换。");
  const { sourceStartSec, sourceEndSec } = primary;
  if (
    !Number.isFinite(sourceStartSec) ||
    !Number.isFinite(sourceEndSec) ||
    sourceStartSec < 0 ||
    sourceEndSec <= sourceStartSec ||
    !take.durationSec ||
    take.durationSec + 0.001 < sourceEndSec
  )
    throw new Error("候选不能覆盖原片段的入点和出点，请先调整裁切。");
  const nextItems = items.map(row =>
    row === item
      ? { ...row, primaryVideoEdit: { ...primary, takeId: take.id } }
      : row
  );
  const value = encodeStoryTimelinePayload(
    appendVideoEditRevision({
      currentValue: timeline.items,
      currentVersion: timeline.version,
      previousStoryBody: body,
      nextStoryBody: body,
      next: { ...stored, items: nextItems },
      savedAt: Date.now(),
    })
  );
  const range = {
    storyId: input.storyId,
    userId: input.userId,
    stableShotId: input.stableShotId,
    takeId: take.id,
    startSec: sourceStartSec,
    endSec: sourceEndSec,
    label: "原位替换",
    source: "manual" as const,
  };
  return { value, range };
}

/** Timeline, trim selection and undo history are one durable edit. */
export async function replacePrimaryTake(input: Swap) {
  const { storyId, userId, stableShotId, takeId } = input;
  const scope = { storyId, userId, stableShotId };
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withLocalAggregateMutationLock(() =>
      withLocalStoryLock(storyId, userId, () =>
        withLocalTimelineLock(storyId, userId, async () => {
          const story = memoryState.stories.find(
            s => s.id === storyId && s.userId === userId
          );
          const timeline = memoryState.storyTimelines.find(
            t => t.storyId === storyId && t.userId === userId
          );
          const previous = memoryState.videoTimelineSelections.find(
            s =>
              s.storyId === storyId &&
              s.userId === userId &&
              s.stableShotId === stableShotId
          );
          const edit = prepare(
            input,
            timeline,
            story?.body,
            memoryState.videoTakes.find(t => t.id === takeId),
            previous
          );
          if (!edit || !timeline) return;
          const date = now(),
            range = {
              ...edit.range,
              id: nextMemoryId("videoTakeRange"),
              createdAt: date,
              updatedAt: date,
            };
          const selected = {
            ...scope,
            takeId,
            rangeId: range.id,
            selectionType: "range" as const,
            id: previous?.id ?? nextMemoryId("videoTimelineSelection"),
            createdAt: previous?.createdAt ?? date,
            updatedAt: date,
          };
          const next = {
            ...timeline,
            version: timeline.version + 1,
            items: edit.value,
            updatedAt: date,
          };
          memoryState.videoTakeRanges.push(range);
          if (previous)
            memoryState.videoTimelineSelections[
              memoryState.videoTimelineSelections.indexOf(previous)
            ] = selected;
          else memoryState.videoTimelineSelections.push(selected);
          memoryState.storyTimelines[
            memoryState.storyTimelines.indexOf(timeline)
          ] = next;
          await persistMemoryState(() => {
            const i = memoryState.storyTimelines.indexOf(next);
            if (i >= 0) memoryState.storyTimelines[i] = timeline;
            const j = memoryState.videoTimelineSelections.indexOf(selected);
            if (j >= 0 && selected.updatedAt === date) {
              if (previous) memoryState.videoTimelineSelections[j] = previous;
              else memoryState.videoTimelineSelections.splice(j, 1);
            }
            memoryState.videoTakeRanges = memoryState.videoTakeRanges.filter(
              r => r !== range
            );
          });
        })
      )
    );
  }
  await db.transaction(async tx => {
    const [story] = await tx
      .select({ body: stories.body })
      .from(stories)
      .where(and(eq(stories.id, storyId), eq(stories.userId, userId)))
      .for("update")
      .limit(1);
    const [timeline] = await tx
      .select()
      .from(storyTimelines)
      .where(
        and(
          eq(storyTimelines.storyId, storyId),
          eq(storyTimelines.userId, userId)
        )
      )
      .for("update")
      .limit(1);
    const [take] = await tx
      .select()
      .from(videoTakes)
      .where(and(eq(videoTakes.id, takeId), eq(videoTakes.userId, userId)))
      .for("update")
      .limit(1);
    const [previous] = await tx
      .select()
      .from(videoTimelineSelections)
      .where(
        and(
          eq(videoTimelineSelections.storyId, storyId),
          eq(videoTimelineSelections.userId, userId),
          eq(videoTimelineSelections.stableShotId, stableShotId)
        )
      )
      .for("update")
      .limit(1);
    const edit = prepare(input, timeline, story?.body, take, previous);
    if (!edit) return;
    const [range] = await tx.insert(videoTakeRanges).values(edit.range);
    const fields = {
      ...scope,
      takeId,
      rangeId: range.insertId,
      selectionType: "range" as const,
    };
    if (previous)
      await tx
        .update(videoTimelineSelections)
        .set(fields)
        .where(eq(videoTimelineSelections.id, previous.id));
    else await tx.insert(videoTimelineSelections).values(fields);
    await tx
      .update(storyTimelines)
      .set({ items: edit.value, version: timeline.version + 1 })
      .where(eq(storyTimelines.id, timeline.id));
  });
}
