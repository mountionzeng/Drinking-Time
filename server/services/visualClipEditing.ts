/**
 * 多轨剪辑的唯一写入口。
 *
 * 以前客户端要移动一个素材，必须自己重建整份 items 数组，再连同 expectedVersion
 * 整份覆盖回来：服务端无从知道用户想动哪一个 clip，也就无法验证「只有它该动」；
 * 客户端拿着的版本号一旦被别处的自动保存顶掉，整次拖动就悄悄回滚。
 *
 * 这里改成服务端自己读—改—写：调用方只说「哪个 clip、去哪条轨、去哪一帧」。
 */
import type {
  StoryTimelineItem,
  StoryTimelineOverlay,
  StoryTimelineVisualLayerState,
} from "../../shared/storyMaterial";
import {
  insertVisualImageClip,
  moveVisualClip,
  removeVisualClip,
  type InsertVisualImageClipInput,
  type VisualEditDocument,
} from "../../shared/visualClipModel";
import { buildTimelineLayout } from "../../shared/timelineLayout";
import { hiddenTimelineVisualLayers } from "../../shared/timelineVisualLayers";
import {
  planTimelineAnchorAdd,
  planTimelineAnchorRemove,
  planTimelineGroupMove,
  planTimelineMagnetDetach,
  planTimelineRollingTrim,
  planTimelineSingleMove,
  planTimelineTrim,
  resolveTimelineFrameSource,
  type TimelinePlan,
  type TimelineResolverShot,
} from "../../shared/timelineCommands";
import { getStoryTimeline, updateStoryTimeline } from "../db";
import { getStoryMaterialState } from "./storyMaterials";

export type VisualClipEditResult =
  | {
      status: "ok";
      timelineVersion: number;
      /** false 表示目标位置与当前一致，没有写入。 */
      changed: boolean;
      /** 打标命令返回新锚点 id，其余命令没有。 */
      anchorId?: string;
    }
  | {
      status: "error";
      error: string;
      /**
       * 两类错误对用户意味着完全不同的下一步，界面必须区别对待：
       * - conflict：别处刚写过，刷新拿最新状态再来一次就行；
       * - invalid：这个操作本身不成立（越过锚点、镜头不在时间轴上……），
       *   重试多少次都一样。
       * 不区分的话，唯一写入口拒绝时用户只能看到一句「失败了」，
       * 于是不变量成立而人被锁在外面——这正是要避免的失败方式。
       */
      errorKind: "conflict" | "invalid";
    };

/** `updateStoryTimeline` 版本不符时抛的就是这句。 */
const TIMELINE_VERSION_CONFLICT = "时间轴版本已更新";

function isVersionConflict(error: unknown): boolean {
  return error instanceof Error && error.message === TIMELINE_VERSION_CONFLICT;
}

async function loadVisualEditDocument(
  storyId: number,
  userId: number
): Promise<
  { document: VisualEditDocument; version: number } | { error: string }
> {
  const row = await getStoryTimeline(storyId, userId);
  if (!row) return { error: "这个故事还没有时间线" };
  if (!Array.isArray(row.items)) return { error: "时间线数据异常，无法编辑" };
  return {
    document: {
      items: row.items as StoryTimelineItem[],
      ...(Array.isArray(row.overlays)
        ? { overlays: row.overlays as StoryTimelineOverlay[] }
        : {}),
      ...(row.visualLayerState
        ? {
            visualLayerState:
              row.visualLayerState as StoryTimelineVisualLayerState,
          }
        : {}),
    },
    version: row.version,
  };
}

/**
 * 每个命令都是同一套动作：读文档 → 纯函数改它 → 服务端自己持有版本 CAS 写回。
 * 三个命令时这段还能靠复制粘贴过日子，加到十个就不行了——所以在扩之前先抽出来，
 * 让「命令」这件事只剩下「你要对文档做什么」这一个变量。
 *
 * 冲突会自动重读重试一次：服务端是读完立刻写，冲突窗口只有这一瞬，
 * 真撞上基本都是别处刚好写完。重试仍冲突才交回给用户。
 */
type VisualEditMutation = (
  document: VisualEditDocument
) =>
  | {
      status: "ok";
      document: VisualEditDocument;
      changed?: boolean;
      anchorId?: string;
    }
  | { status: "error"; message: string };

const CONFLICT_RETRY_LIMIT = 1;

async function withVisualEditDocument(
  input: { storyId: number; userId: number; failureMessage: string },
  mutate: VisualEditMutation
): Promise<VisualClipEditResult> {
  for (let attempt = 0; ; attempt += 1) {
    const loaded = await loadVisualEditDocument(input.storyId, input.userId);
    if ("error" in loaded) {
      return { status: "error", error: loaded.error, errorKind: "invalid" };
    }

    const result = mutate(loaded.document);
    if (result.status === "error") {
      return { status: "error", error: result.message, errorKind: "invalid" };
    }
    // 目标与当前一致：不写库，也就不会因为重试把版本号越推越高。
    if (result.changed === false) {
      return { status: "ok", timelineVersion: loaded.version, changed: false };
    }

    try {
      const saved = await updateStoryTimeline({
        storyId: input.storyId,
        userId: input.userId,
        // 版本来自刚刚这次服务端读取，客户端不再持有版本号。
        expectedVersion: loaded.version,
        items: result.document.items,
        ...(result.document.overlays === undefined
          ? {}
          : { overlays: result.document.overlays }),
        ...(result.document.visualLayerState === undefined
          ? {}
          : { visualLayerState: result.document.visualLayerState }),
      });
      return {
        status: "ok",
        timelineVersion: saved.version,
        changed: true,
        ...(result.anchorId === undefined ? {} : { anchorId: result.anchorId }),
      };
    } catch (error) {
      if (isVersionConflict(error) && attempt < CONFLICT_RETRY_LIMIT) {
        continue;
      }
      if (isVersionConflict(error)) {
        return {
          status: "error",
          error: "别处刚刚也在改这条时间线，请刷新后重试",
          errorKind: "conflict",
        };
      }
      return {
        status: "error",
        error: error instanceof Error ? error.message : input.failureMessage,
        errorKind: "invalid",
      };
    }
  }
}

/**
 * planner 系列命令的桥：它们要的 rows 由 items 直接算出，要的镜头素材信息
 * 全部来自服务端已有的 getStoryMaterialState——**客户端一个派生状态都不用传**。
 * 这是「批量操作也走服务端命令」能成立的关键：客户端只说做什么，不说算成什么。
 */
type TimelinePlanner = (context: {
  document: VisualEditDocument;
  rows: ReturnType<typeof buildTimelineLayout>;
  shotsById: ReadonlyMap<string, TimelineResolverShot>;
}) => TimelinePlan;

async function loadResolverShots(
  storyId: number,
  userId: number
): Promise<ReadonlyMap<string, TimelineResolverShot>> {
  const state = await getStoryMaterialState(storyId, userId);
  return new Map(
    (state?.shots ?? []).map(shot => [
      shot.stableShotId,
      {
        currentImageId: shot.currentImage?.id ?? null,
        currentVideoDurationSec: shot.currentVideo?.durationSec ?? null,
      },
    ])
  );
}

async function withTimelinePlan(
  input: {
    storyId: number;
    userId: number;
    failureMessage: string;
    /** 只有滚动剪辑、修剪和打标需要镜头素材时长；其余命令别白跑一次读取。 */
    needsShotMaterials?: boolean;
  },
  planner: TimelinePlanner
): Promise<VisualClipEditResult> {
  const shotsById = input.needsShotMaterials
    ? await loadResolverShots(input.storyId, input.userId)
    : new Map<string, TimelineResolverShot>();

  return withVisualEditDocument(input, document => {
    const rows = buildTimelineLayout(document.items);
    const plan = planner({ document, rows, shotsById });
    if (plan.kind !== "ok") return { status: "error", message: plan.reason };
    return {
      status: "ok",
      document: { ...document, items: plan.items },
      ...(plan.anchorId === undefined ? {} : { anchorId: plan.anchorId }),
    };
  });
}

export async function moveVisualClipForStory(input: {

  storyId: number;
  userId: number;
  clipId: string;
  toTrackId: string;
  toStartFrame: number;
}): Promise<VisualClipEditResult> {
  return withVisualEditDocument(
    { storyId: input.storyId, userId: input.userId, failureMessage: "移动没有保存成功" },
    document =>
      moveVisualClip(document, {
        clipId: input.clipId,
        toTrackId: input.toTrackId,
        toStartFrame: input.toStartFrame,
      })
  );
}

export async function insertVisualImageClipForStory(input: {
  storyId: number;
  userId: number;
  clip: InsertVisualImageClipInput;
}): Promise<VisualClipEditResult> {
  return withVisualEditDocument(
    { storyId: input.storyId, userId: input.userId, failureMessage: "素材没有放置成功" },
    document => insertVisualImageClip(document, input.clip)
  );
}

export async function removeVisualClipForStory(input: {
  storyId: number;
  userId: number;
  clipId: string;
}): Promise<VisualClipEditResult> {
  return withVisualEditDocument(
    { storyId: input.storyId, userId: input.userId, failureMessage: "素材没有删除成功" },
    document => removeVisualClip(document, input.clipId)
  );
}

// ────────────────────────────────────────────────────────────────────
// planner 系列命令
//
// 这七个操作以前的走法是：客户端跑 planner 算出整份 items，再连同
// expectedVersion 整份覆盖回来。服务端因此无从判断用户到底想动什么，
// 也就无法保证「只有它该动」。现在客户端只发领域参数，planner 在服务端跑。
// ────────────────────────────────────────────────────────────────────

export async function moveShotGroupForStory(input: {
  storyId: number;
  userId: number;
  sourceShotId: string;
  direction: "left" | "right";
  deltaFrames: number;
}): Promise<VisualClipEditResult> {
  return withTimelinePlan(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "移动镜头失败",
    },
    ({ document, rows }) =>
      planTimelineGroupMove({
        items: document.items,
        rows,
        sourceShotId: input.sourceShotId,
        direction: input.direction,
        deltaFrames: input.deltaFrames,
      })
  );
}

export async function moveShotSingleForStory(input: {
  storyId: number;
  userId: number;
  stableShotId: string;
  deltaFrames: number;
  snapThresholdFrames?: number;
}): Promise<VisualClipEditResult> {
  return withTimelinePlan(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "移动镜头失败",
    },
    ({ document, rows }) =>
      planTimelineSingleMove({
        items: document.items,
        rows,
        stableShotId: input.stableShotId,
        deltaFrames: input.deltaFrames,
        ...(input.snapThresholdFrames === undefined
          ? {}
          : { snapThresholdFrames: input.snapThresholdFrames }),
      })
  );
}

export async function rollingTrimForStory(input: {
  storyId: number;
  userId: number;
  leftStableShotId: string;
  rightStableShotId: string;
  requestedBoundaryFrame: number;
}): Promise<VisualClipEditResult> {
  return withTimelinePlan(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "滚动剪辑失败",
      needsShotMaterials: true,
    },
    ({ document, rows, shotsById }) =>
      planTimelineRollingTrim({
        items: document.items,
        rows,
        leftStableShotId: input.leftStableShotId,
        rightStableShotId: input.rightStableShotId,
        requestedBoundaryFrame: input.requestedBoundaryFrame,
        leftSourceLimitSec:
          shotsById.get(input.leftStableShotId)?.currentVideoDurationSec ?? null,
        rightSourceLimitSec:
          shotsById.get(input.rightStableShotId)?.currentVideoDurationSec ??
          null,
      })
  );
}

export async function magnetDetachForStory(input: {
  storyId: number;
  userId: number;
  leftStableShotId: string;
  rightStableShotId: string;
}): Promise<VisualClipEditResult> {
  return withTimelinePlan(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "取消吸附失败",
    },
    ({ document, rows }) =>
      planTimelineMagnetDetach({
        items: document.items,
        rows,
        leftStableShotId: input.leftStableShotId,
        rightStableShotId: input.rightStableShotId,
      })
  );
}

export async function addTimelineAnchorForStory(input: {
  storyId: number;
  userId: number;
  timelineFrame: number;
}): Promise<VisualClipEditResult> {
  return withTimelinePlan(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "打标失败",
      needsShotMaterials: true,
    },
    ({ document, rows, shotsById }) =>
      planTimelineAnchorAdd({
        items: document.items,
        // 客户端以前把「这一帧对应哪个画面」算好了再传；现在服务端自己解析，
        // 用的是同一个 resolveTimelineVisualFrame 入口，隐藏层一并生效。
        resolution: resolveTimelineFrameSource({
          rows,
          shotsById,
          ...(document.overlays === undefined
            ? {}
            : { overlays: document.overlays }),
          hiddenVisualLayers: Array.from(
            hiddenTimelineVisualLayers(document.visualLayerState)
          ),
          timelineFrame: input.timelineFrame,
        }),
      })
  );
}

export async function removeTimelineAnchorForStory(input: {
  storyId: number;
  userId: number;
  stableShotId: string;
  anchorId: string;
}): Promise<VisualClipEditResult> {
  return withTimelinePlan(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "取消打标失败",
    },
    ({ document }) =>
      planTimelineAnchorRemove({
        items: document.items,
        stableShotId: input.stableShotId,
        anchorId: input.anchorId,
      })
  );
}

export async function trimShotForStory(input: {
  storyId: number;
  userId: number;
  stableShotId: string;
  edge: "start" | "end";
  requestedBoundaryFrame: number;
}): Promise<VisualClipEditResult> {
  return withTimelinePlan(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "修剪失败",
      needsShotMaterials: true,
    },
    ({ document, shotsById }) =>
      planTimelineTrim({
        items: document.items,
        stableShotId: input.stableShotId,
        edge: input.edge,
        requestedBoundaryFrame: input.requestedBoundaryFrame,
        sourceLimitSec:
          shotsById.get(input.stableShotId)?.currentVideoDurationSec ?? null,
      })
  );
}
