import type {
  VideoTakeRange,
  VideoTimelineSelection,
} from "../../drizzle/schema";
import { normalizeShotIdentity } from "../../shared/shotIdentity";
import {
  clearVideoTimelineSelection,
  createVideoTakeRange,
  getStoryById,
  getVideoTakeById,
  getVideoTakeRangeById,
  setVideoTimelineSelection,
} from "../db";

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
      Number.isFinite(input.plannedDurationSec)
        ? input.plannedDurationSec
        : 3,
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
