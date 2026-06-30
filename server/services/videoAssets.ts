import type {
  VideoTake as DbVideoTake,
  VideoTakeRange as DbVideoTakeRange,
  VideoTimelineSelection as DbVideoTimelineSelection,
} from "../../drizzle/schema";
import type {
  VideoTakeAsset,
  VideoTakeRange,
  VideoTimelineSelection,
} from "../../shared/videoAsset";
import {
  getStoryById,
  getStoryVideoTakeRanges,
  getStoryVideoTakes,
  getStoryVideoTimelineSelections,
} from "../db";

function toIso(value: Date): string {
  return value.toISOString();
}

function safeSnapshot(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of [
    "provider",
    "model",
    "durationSec",
    "aspectRatio",
    "submitUrl",
    "submittedParameters",
    "sourceImageId",
    "previousReferenceImageId",
    "previousReferenceShotNo",
    "nextReferenceImageId",
    "nextReferenceShotNo",
    "motion",
    "taskId",
    "generatedAt",
    "resultSelectionRule",
  ]) {
    if (record[key] !== undefined) safe[key] = record[key];
  }
  return safe;
}

function projectRange(range: DbVideoTakeRange): VideoTakeRange {
  return {
    id: range.id,
    takeId: range.takeId,
    storyId: range.storyId,
    userId: range.userId,
    stableShotId: range.stableShotId,
    startSec: range.startSec,
    endSec: range.endSec,
    label: range.label,
    source: range.source,
    createdAt: toIso(range.createdAt),
    updatedAt: toIso(range.updatedAt),
  };
}

function projectSelection(
  selection: DbVideoTimelineSelection
): VideoTimelineSelection {
  return {
    id: selection.id,
    storyId: selection.storyId,
    userId: selection.userId,
    stableShotId: selection.stableShotId,
    takeId: selection.takeId,
    rangeId: selection.rangeId,
    selectionType: selection.selectionType,
    createdAt: toIso(selection.createdAt),
    updatedAt: toIso(selection.updatedAt),
  };
}

export async function getStoryVideoAssets(
  storyId: number,
  userId: number
): Promise<VideoTakeAsset[]> {
  const story = await getStoryById(storyId, userId);
  if (!story) return [];

  const [takes, ranges, selections] = await Promise.all([
    getStoryVideoTakes(storyId, userId),
    getStoryVideoTakeRanges(storyId, userId),
    getStoryVideoTimelineSelections(storyId, userId),
  ]);
  const rangesByTake = new Map<number, VideoTakeRange[]>();
  for (const range of ranges.map(projectRange)) {
    const group = rangesByTake.get(range.takeId) ?? [];
    group.push(range);
    rangesByTake.set(range.takeId, group);
  }
  const selectedByShot = new Map(
    selections
      .map(projectSelection)
      .map(selection => [selection.stableShotId, selection])
  );

  return takes.map((take: DbVideoTake): VideoTakeAsset => {
    const selection = selectedByShot.get(take.stableShotId);
    return {
      id: take.id,
      storyId: take.storyId,
      userId: take.userId,
      stableShotId: take.stableShotId,
      sourceImageId: take.sourceImageId,
      promptCompilationId: take.promptCompilationId,
      promptFreshness: "legacy",
      status: take.status,
      taskId: take.taskId,
      provider: take.provider,
      model: take.model,
      prompt: take.prompt,
      subtitle: take.subtitle,
      durationSec: take.durationSec,
      aspectRatio: take.aspectRatio,
      videoKey: take.videoKey,
      videoUrl: take.videoUrl,
      errorMessage: take.errorMessage,
      parameterSnapshot: safeSnapshot(take.parameterSnapshot),
      extractionCapability: take.extractionCapability,
      createdAt: toIso(take.createdAt),
      updatedAt: toIso(take.updatedAt),
      ranges: rangesByTake.get(take.id) ?? [],
      selectedRangeId: selection?.takeId === take.id ? selection.rangeId : null,
      selectedSelectionType:
        selection?.takeId === take.id ? selection.selectionType : null,
      isTimelineSelected: selection?.takeId === take.id,
      isStale: false,
      staleReasons: [],
    };
  });
}
