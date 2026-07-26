import type {
  VideoTake,
  VideoTakeRange,
  VideoTimelineSelection,
} from "../../drizzle/schema";
import { normalizeShotIdentity } from "../../shared/shotIdentity";
import {
  DEFAULT_TIMELINE_VIDEO_EFFECTS,
  type StoryTimelineItem,
  type StoryTimelineVisualClip,
  type TimelineTransform,
  type TimelineVideoEffects,
} from "../../shared/storyMaterial";
import { insertTimelineVisualClip } from "../../shared/timelineVisualClips";
import {
  clearVideoTimelineSelection,
  createVideoTake,
  createVideoTakeRange,
  getStoryById,
  getStoryVideoTimelineSelections,
  getVideoTakeById,
  getVideoTakeRangeById,
  setVideoTimelineSelection,
  updateStoryTimeline,
  updateVideoTake,
  updateVideoTakeRangesShotIdentity,
} from "../db";
import { getStoryMaterialState } from "./storyMaterials";

function finiteSecond(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

async function assertStory(storyId: number, userId: number) {
  const story = await getStoryById(storyId, userId);
  if (!story) throw new Error("故事不存在或无权操作");
}

async function assertAvailableTake(input: {
  storyId: number;
  userId: number;
  takeId: number;
  stableShotId: string;
}) {
  const take = await getVideoTakeById(input.takeId, input.userId);
  if (
    !take ||
    take.storyId !== input.storyId ||
    take.userId !== input.userId ||
    take.stableShotId !== input.stableShotId
  ) {
    throw new Error("视频素材不存在或不属于当前镜头");
  }
  if (take.status !== "available" || !take.videoUrl) {
    throw new Error("只有已生成且可播放的视频素材才能进入时间轴");
  }
  return take;
}

export async function createUsableVideoRange(
  input: {
    storyId: number;
    stableShotId: string;
    takeId: number;
    startSec: number;
    endSec: number;
    label?: string | null;
    useOnTimeline?: boolean;
  },
  userId: number
): Promise<{
  range: VideoTakeRange;
  selection: VideoTimelineSelection | null;
}> {
  await assertStory(input.storyId, userId);
  const stableShotId = normalizeShotIdentity(input.stableShotId);
  if (!stableShotId) throw new Error("镜头缺少稳定身份");
  const take = await assertAvailableTake({
    storyId: input.storyId,
    userId,
    takeId: input.takeId,
    stableShotId,
  });
  if (
    !finiteSecond(input.startSec) ||
    !finiteSecond(input.endSec) ||
    input.endSec <= input.startSec
  ) {
    throw new Error("片段时间范围无效");
  }
  if (
    typeof take.durationSec === "number" &&
    input.endSec > take.durationSec + 0.001
  ) {
    throw new Error("片段结束时间超出视频时长");
  }

  const range = await createVideoTakeRange({
    takeId: take.id,
    storyId: input.storyId,
    userId,
    stableShotId,
    startSec: input.startSec,
    endSec: input.endSec,
    label: input.label?.trim() || null,
    source: "manual",
  });
  const selection = input.useOnTimeline
    ? await setVideoTimelineSelection({
        storyId: input.storyId,
        userId,
        stableShotId,
        takeId: take.id,
        rangeId: range.id,
        selectionType: "range",
      })
    : null;
  return { range, selection };
}

export async function selectVideoTimelineSegment(
  input: {
    storyId: number;
    stableShotId: string;
    takeId: number;
    rangeId?: number | null;
    selectionType: "full_take" | "range";
  },
  userId: number
): Promise<VideoTimelineSelection> {
  await assertStory(input.storyId, userId);
  const stableShotId = normalizeShotIdentity(input.stableShotId);
  if (!stableShotId) throw new Error("镜头缺少稳定身份");
  const take = await assertAvailableTake({
    storyId: input.storyId,
    userId,
    takeId: input.takeId,
    stableShotId,
  });
  let rangeId: number | null = null;
  if (input.selectionType === "range") {
    if (input.rangeId == null) throw new Error("选择片段时必须提供 rangeId");
    const range = await getVideoTakeRangeById(input.rangeId, userId);
    if (
      !range ||
      range.storyId !== input.storyId ||
      range.takeId !== take.id ||
      range.stableShotId !== stableShotId
    ) {
      throw new Error("片段不存在或不属于当前视频素材");
    }
    rangeId = range.id;
  }

  return setVideoTimelineSelection({
    storyId: input.storyId,
    userId,
    stableShotId,
    takeId: take.id,
    rangeId,
    selectionType: input.selectionType,
  });
}

export async function clearVideoTimelineSegment(
  input: {
    storyId: number;
    stableShotId: string;
  },
  userId: number
): Promise<void> {
  await assertStory(input.storyId, userId);
  const stableShotId = normalizeShotIdentity(input.stableShotId);
  if (!stableShotId) throw new Error("镜头缺少稳定身份");
  await clearVideoTimelineSelection(input.storyId, userId, stableShotId);
}

export async function markVideoTakeUnusable(
  input: {
    storyId: number;
    takeId: number;
  },
  userId: number
): Promise<{
  take: VideoTake;
  clearedTimelineSelection: boolean;
}> {
  await assertStory(input.storyId, userId);
  const take = await getVideoTakeById(input.takeId, userId);
  if (!take || take.storyId !== input.storyId || take.userId !== userId) {
    throw new Error("视频素材不存在或无权标记");
  }

  const selections = await getStoryVideoTimelineSelections(
    input.storyId,
    userId
  );
  const selected = selections.find(selection => selection.takeId === take.id);
  if (selected) {
    await clearVideoTimelineSelection(
      input.storyId,
      userId,
      selected.stableShotId
    );
  }

  const parameterSnapshot =
    take.parameterSnapshot &&
    typeof take.parameterSnapshot === "object" &&
    !Array.isArray(take.parameterSnapshot)
      ? {
          ...(take.parameterSnapshot as Record<string, unknown>),
          manuallyMarkedUnusable: true,
          manuallyMarkedUnusableAt: new Date().toISOString(),
        }
      : {
          manuallyMarkedUnusable: true,
          manuallyMarkedUnusableAt: new Date().toISOString(),
        };
  const updated = await updateVideoTake(take.id, userId, {
    status: "unfollowable",
    errorMessage: "用户标记为不可用。",
    parameterSnapshot,
  });
  if (!updated) throw new Error("视频素材标记失败");

  return {
    take: updated,
    clearedTimelineSelection: Boolean(selected),
  };
}

export async function adoptVideoTake(
  input: {
    storyId: number;
    stableShotId: string;
    takeId: number;
    plannedDurationSec: number;
  },
  userId: number
): Promise<{
  range: VideoTakeRange;
  selection: VideoTimelineSelection;
}> {
  const stableShotId = normalizeShotIdentity(input.stableShotId);
  if (!stableShotId) throw new Error("镜头缺少稳定身份");
  const take = await assertAvailableTake({
    storyId: input.storyId,
    userId,
    takeId: input.takeId,
    stableShotId,
  });
  const endSec = Math.max(
    0.1,
    Math.min(
      Number.isFinite(input.plannedDurationSec) ? input.plannedDurationSec : 3,
      take.durationSec ?? input.plannedDurationSec ?? 3
    )
  );
  const result = await createUsableVideoRange(
    {
      storyId: input.storyId,
      stableShotId,
      takeId: take.id,
      startSec: 0,
      endSec,
      label: "采用片段",
      useOnTimeline: true,
    },
    userId
  );
  if (!result.selection) throw new Error("视频采用失败");
  return { range: result.range, selection: result.selection };
}

export async function reuseVideoTakeForShot(
  input: {
    storyId: number;
    sourceTakeId: number;
    targetStableShotId: string;
    plannedDurationSec: number;
  },
  userId: number
): Promise<{
  take: VideoTake;
  range: VideoTakeRange;
  selection: VideoTimelineSelection;
}> {
  await assertStory(input.storyId, userId);
  const targetStableShotId = normalizeShotIdentity(input.targetStableShotId);
  if (!targetStableShotId) throw new Error("目标镜头缺少稳定身份");

  const sourceTake = await getVideoTakeById(input.sourceTakeId, userId);
  if (!sourceTake || sourceTake.userId !== userId) {
    throw new Error("视频素材不存在或无权复用");
  }
  if (sourceTake.status !== "available" || !sourceTake.videoUrl) {
    throw new Error("只有已生成且可播放的视频素材才能复用");
  }

  const sourceSnapshot =
    sourceTake.parameterSnapshot &&
    typeof sourceTake.parameterSnapshot === "object" &&
    !Array.isArray(sourceTake.parameterSnapshot)
      ? (sourceTake.parameterSnapshot as Record<string, unknown>)
      : {};
  const take = await createVideoTake({
    storyId: input.storyId,
    userId,
    stableShotId: targetStableShotId,
    sourceImageId: null,
    promptCompilationId: null,
    status: "available",
    taskId: null,
    provider: sourceTake.provider,
    model: sourceTake.model,
    prompt: sourceTake.prompt,
    subtitle: sourceTake.subtitle,
    durationSec: sourceTake.durationSec,
    aspectRatio: sourceTake.aspectRatio,
    videoKey: sourceTake.videoKey,
    videoUrl: sourceTake.videoUrl,
    errorMessage: null,
    parameterSnapshot: {
      ...sourceSnapshot,
      reusedFromTakeId: sourceTake.id,
      reusedFromStoryId: sourceTake.storyId,
      reusedFromStableShotId: sourceTake.stableShotId,
      reusedAt: new Date().toISOString(),
    },
    extractionCapability: sourceTake.extractionCapability,
  });

  const result = await adoptVideoTake(
    {
      storyId: input.storyId,
      stableShotId: targetStableShotId,
      takeId: take.id,
      plannedDurationSec: input.plannedDurationSec,
    },
    userId
  );

  return { take, range: result.range, selection: result.selection };
}

function inferredClipEffects(input: {
  sourceStartSec: number;
  sourceEndSec: number;
  durationMs: number;
  effects?: TimelineVideoEffects;
}): TimelineVideoEffects {
  if (input.effects) return { ...input.effects };
  const sourceDurationSec = Math.max(
    1 / 30,
    input.sourceEndSec - input.sourceStartSec
  );
  return {
    ...DEFAULT_TIMELINE_VIDEO_EFFECTS,
    playbackRate: Math.min(
      4,
      Math.max(0.25, sourceDurationSec / Math.max(0.1, input.durationMs / 1000))
    ),
  };
}

async function cloneTakeIntoStory(input: {
  storyId: number;
  targetStableShotId: string;
  sourceTake: VideoTake;
  userId: number;
}): Promise<VideoTake> {
  const snapshot =
    input.sourceTake.parameterSnapshot &&
    typeof input.sourceTake.parameterSnapshot === "object" &&
    !Array.isArray(input.sourceTake.parameterSnapshot)
      ? (input.sourceTake.parameterSnapshot as Record<string, unknown>)
      : {};
  return createVideoTake({
    storyId: input.storyId,
    userId: input.userId,
    stableShotId: input.targetStableShotId,
    sourceImageId: null,
    promptCompilationId: null,
    status: "available",
    taskId: null,
    provider: input.sourceTake.provider,
    model: input.sourceTake.model,
    prompt: input.sourceTake.prompt,
    subtitle: input.sourceTake.subtitle,
    durationSec: input.sourceTake.durationSec,
    aspectRatio: input.sourceTake.aspectRatio,
    videoKey: input.sourceTake.videoKey,
    videoUrl: input.sourceTake.videoUrl,
    errorMessage: null,
    parameterSnapshot: {
      ...snapshot,
      reusedFromTakeId: input.sourceTake.id,
      reusedFromStoryId: input.sourceTake.storyId,
      reusedFromStableShotId: input.sourceTake.stableShotId,
      reusedAt: new Date().toISOString(),
      reuseMode: "timeline_clip",
    },
    extractionCapability: input.sourceTake.extractionCapability,
  });
}

export async function appendVideoTakeToTimeline(
  input: {
    storyId: number;
    sourceTakeId: number;
    targetStableShotId: string;
    sourceStartSec: number;
    sourceEndSec: number;
    effects: TimelineVideoEffects;
    transform: TimelineTransform;
    targetOffsetMs?: number;
    expectedTimelineVersion: number;
  },
  userId: number
): Promise<{
  timeline: Awaited<ReturnType<typeof updateStoryTimeline>>;
  beforeItems: StoryTimelineItem[];
  clip: StoryTimelineVisualClip;
}> {
  await assertStory(input.storyId, userId);
  const targetStableShotId = normalizeShotIdentity(input.targetStableShotId);
  if (!targetStableShotId) throw new Error("目标镜头缺少稳定身份");
  const material = await getStoryMaterialState(input.storyId, userId);
  if (!material) throw new Error("故事素材尚未加载");
  if (material.timeline.version !== input.expectedTimelineVersion) {
    throw new Error("时间轴已经更新，请重新追加视频");
  }
  const targetShot = material.shots.find(
    shot => shot.stableShotId === targetStableShotId
  );
  const targetItem = material.timeline.items.find(
    item => item.stableShotId === targetStableShotId
  );
  if (!targetShot || !targetItem) throw new Error("目标镜头不在当前时间线上");

  const originalSourceTake = await getVideoTakeById(input.sourceTakeId, userId);
  if (
    !originalSourceTake ||
    originalSourceTake.userId !== userId ||
    originalSourceTake.status !== "available" ||
    !originalSourceTake.videoUrl
  ) {
    throw new Error("只有可播放的视频才能追加到镜头");
  }
  let sourceTake = originalSourceTake;
  if (sourceTake.storyId !== input.storyId) {
    sourceTake = await cloneTakeIntoStory({
      storyId: input.storyId,
      targetStableShotId,
      sourceTake,
      userId,
    });
  }
  if (!sourceTake.videoUrl) {
    throw new Error("复用后的视频文件不可播放");
  }
  const sourceVideoUrl = sourceTake.videoUrl;
  const sourceStartSec = Math.max(0, input.sourceStartSec);
  const sourceEndSec = Math.max(sourceStartSec + 1 / 30, input.sourceEndSec);
  if (
    typeof sourceTake.durationSec === "number" &&
    sourceEndSec > sourceTake.durationSec + 0.001
  ) {
    throw new Error("追加片段的出点超过了视频时长");
  }
  const sourceRange = await createUsableVideoRange(
    {
      storyId: input.storyId,
      stableShotId: sourceTake.stableShotId,
      takeId: sourceTake.id,
      startSec: sourceStartSec,
      endSec: sourceEndSec,
      label: "时间线追加片段",
      useOnTimeline: false,
    },
    userId
  );
  const clipDurationMs = Math.max(
    100,
    Math.round(
      ((sourceEndSec - sourceStartSec) * 1_000) /
        Math.min(4, Math.max(0.25, input.effects.playbackRate))
    )
  );
  const clip: StoryTimelineVisualClip = {
    id: `append-${sourceRange.range.id}-${Date.now()}`,
    takeId: sourceTake.id,
    rangeId: sourceRange.range.id,
    sourceStableShotId: sourceTake.stableShotId,
    videoUrl: sourceVideoUrl,
    label: originalSourceTake.subtitle?.trim() || `Take ${sourceTake.id}`,
    sourceStartSec,
    sourceEndSec,
    offsetMs: 0,
    durationMs: clipDurationMs,
    effects: { ...input.effects },
    transform: { ...input.transform },
  };

  let primaryClip: StoryTimelineVisualClip | null = null;
  const primaryVideo = targetShot.currentVideo;
  if (
    !targetItem.visualClipsReplacePrimary &&
    primaryVideo?.videoUrl &&
    primaryVideo.status === "available"
  ) {
    const selectedRange =
      primaryVideo.selectedSelectionType === "range" &&
      primaryVideo.selectedRangeId != null
        ? primaryVideo.ranges.find(
            range => range.id === primaryVideo.selectedRangeId
          )
        : null;
    const edit =
      targetItem.primaryVideoEdit?.takeId === primaryVideo.id
        ? targetItem.primaryVideoEdit
        : null;
    const primaryStartSec = Math.max(
      0,
      edit?.sourceStartSec ?? selectedRange?.startSec ?? 0
    );
    const primaryEndSec = Math.max(
      primaryStartSec + 1 / 30,
      edit?.sourceEndSec ??
        selectedRange?.endSec ??
        primaryVideo.durationSec ??
        primaryStartSec + targetItem.plannedDurationMs / 1_000
    );
    const primaryEffects = inferredClipEffects({
      sourceStartSec: primaryStartSec,
      sourceEndSec: primaryEndSec,
      durationMs: targetItem.plannedDurationMs,
      effects: edit?.effects,
    });
    const primaryRange = await createUsableVideoRange(
      {
        storyId: input.storyId,
        stableShotId: targetStableShotId,
        takeId: primaryVideo.id,
        startSec: primaryStartSec,
        endSec: primaryEndSec,
        label: "原主视频片段",
        useOnTimeline: false,
      },
      userId
    );
    primaryClip = {
      id: `primary-${primaryRange.range.id}`,
      takeId: primaryVideo.id,
      rangeId: primaryRange.range.id,
      sourceStableShotId: targetStableShotId,
      videoUrl: primaryVideo.videoUrl,
      label: primaryVideo.subtitle?.trim() || `Take ${primaryVideo.id}`,
      sourceStartSec: primaryStartSec,
      sourceEndSec: primaryEndSec,
      offsetMs: 0,
      durationMs: Math.max(
        100,
        Math.round(
          ((primaryEndSec - primaryStartSec) * 1_000) /
            primaryEffects.playbackRate
        )
      ),
      effects: primaryEffects,
      transform: { ...targetItem.transform },
    };
  }

  const nextTargetItem = insertTimelineVisualClip({
    item: targetItem,
    clip,
    primaryClip,
    targetOffsetMs: input.targetOffsetMs,
  });
  const beforeItems = material.timeline.items.map(item => ({
    ...item,
    transform: { ...item.transform },
    visualClips: item.visualClips?.map(existing => ({ ...existing })),
  }));
  const timeline = await updateStoryTimeline({
    storyId: input.storyId,
    userId,
    expectedVersion: material.timeline.version,
    items: material.timeline.items.map((item, position) => ({
      ...(item.stableShotId === targetStableShotId ? nextTargetItem : item),
      position,
    })),
  });
  return { timeline, beforeItems, clip };
}

export async function moveVideoTakeToShot(
  input: {
    storyId: number;
    takeId: number;
    targetStableShotId: string;
  },
  userId: number
): Promise<{
  takeId: number;
  sourceStableShotId: string;
  targetStableShotId: string;
  movedTimelineSelection: boolean;
}> {
  await assertStory(input.storyId, userId);
  const targetStableShotId = normalizeShotIdentity(input.targetStableShotId);
  if (!targetStableShotId) throw new Error("目标镜头缺少稳定身份");

  const take = await getVideoTakeById(input.takeId, userId);
  if (!take || take.storyId !== input.storyId || take.userId !== userId) {
    throw new Error("视频素材不存在或无权移动");
  }
  const sourceStableShotId = take.stableShotId;
  if (sourceStableShotId === targetStableShotId) {
    return {
      takeId: take.id,
      sourceStableShotId,
      targetStableShotId,
      movedTimelineSelection: false,
    };
  }

  const selections = await getStoryVideoTimelineSelections(
    input.storyId,
    userId
  );
  const movedSelection =
    selections.find(selection => selection.takeId === take.id) ?? null;

  if (movedSelection) {
    await clearVideoTimelineSelection(
      input.storyId,
      userId,
      movedSelection.stableShotId
    );
  }

  const parameterSnapshot =
    take.parameterSnapshot &&
    typeof take.parameterSnapshot === "object" &&
    !Array.isArray(take.parameterSnapshot)
      ? {
          ...(take.parameterSnapshot as Record<string, unknown>),
          assignedStableShotId: targetStableShotId,
        }
      : take.parameterSnapshot;

  const updated = await updateVideoTake(take.id, userId, {
    stableShotId: targetStableShotId,
    parameterSnapshot,
  });
  if (!updated) throw new Error("视频素材移动失败");

  await updateVideoTakeRangesShotIdentity({
    takeId: take.id,
    storyId: input.storyId,
    userId,
    stableShotId: targetStableShotId,
  });

  if (movedSelection) {
    await setVideoTimelineSelection({
      storyId: input.storyId,
      userId,
      stableShotId: targetStableShotId,
      takeId: take.id,
      rangeId: movedSelection.rangeId,
      selectionType: movedSelection.selectionType,
    });
  }

  return {
    takeId: take.id,
    sourceStableShotId,
    targetStableShotId,
    movedTimelineSelection: Boolean(movedSelection),
  };
}
