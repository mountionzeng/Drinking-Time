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
import {
  applyTimelineVisualLayerAction,
  hiddenTimelineVisualLayers,
  type TimelineVisualLayerAction,
} from "../../shared/timelineVisualLayers";
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

/**
 * 单镜移动。除了横向位移，它还要在同一次写入里完成另外两件事——这两件以前
 * 都在客户端做，是「一次拖动」在用户眼里不可分割的一部分：
 *
 * 1. 换层：斜向拖动一次提交，位置与视觉层一起变；帧差为 0 时也允许只换层。
 * 2. 迁移遗留 overlay：老的 overlay 记录在镜头第一次被移动或换层时就地转成
 *    普通上层镜头并删除专用覆盖记录（账本 extracted-frame-overlay-video 第 15 条）。
 *
 * 这三件必须原子：拆成两次写入的话，中途失败会留下「层改了但位置没改」或者
 * 「overlay 删了但镜头没上去」这种没人能修的半状态。
 */
export async function moveShotSingleForStory(input: {
  storyId: number;
  userId: number;
  stableShotId: string;
  deltaFrames: number;
  snapThresholdFrames?: number;
  toVisualLayer?: number;
}): Promise<VisualClipEditResult> {
  return withVisualEditDocument(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "移动镜头失败",
    },
    document => {
      const rows = buildTimelineLayout(document.items);
      const sourceItem = document.items.find(
        item => item.stableShotId === input.stableShotId
      );
      if (!sourceItem) {
        return { status: "error", message: "镜头不在时间轴中" };
      }
      const overlay = (document.overlays ?? []).find(
        candidate => candidate.sourceStableShotId === input.stableShotId
      );
      const targetLayer =
        input.toVisualLayer == null
          ? undefined
          : Math.max(0, Math.round(input.toVisualLayer));
      const layerChanged =
        targetLayer != null && targetLayer !== (sourceItem.visualLayer ?? 0);

      // 只换层不平移：没有位移要算，直接拿当前 items 往下走。
      const plan: TimelinePlan =
        input.deltaFrames === 0 && layerChanged
          ? { kind: "ok", items: [...document.items] }
          : planTimelineSingleMove({
              items: document.items,
              rows,
              stableShotId: input.stableShotId,
              deltaFrames: input.deltaFrames,
              ...(input.snapThresholdFrames === undefined
                ? {}
                : { snapThresholdFrames: input.snapThresholdFrames }),
            });
      if (plan.kind !== "ok") {
        return { status: "error", message: plan.reason };
      }

      const needsLayerWrite = targetLayer != null || overlay !== undefined;
      const items = needsLayerWrite
        ? plan.items.map(item =>
            item.stableShotId === input.stableShotId
              ? // overlay 迁移时默认落在第 1 层：遗留 overlay 本来就画在
                // 底层视频之上，不给层号会掉回底层把画面盖掉。
                { ...item, visualLayer: targetLayer ?? 1 }
              : item
          )
        : plan.items;

      return {
        status: "ok",
        document: {
          ...document,
          items,
          ...(overlay === undefined
            ? {}
            : {
                overlays: (document.overlays ?? []).filter(
                  candidate => candidate.id !== overlay.id
                ),
              }),
        },
      };
    }
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

/**
 * 图层管理：插入、整层上下移动、删除、显隐切换。
 *
 * 这四件事都必须在一次写入里把层内**全部**素材（图片、视频、遗留 overlay）
 * 一起重编号——账本 extracted-frame-overlay-video 第 13、27 条。
 * 以前由客户端算好整份 items 再写回；现在服务端读了自己算。
 *
 * 隐藏一层不得改变其它层任何素材的绝对时间（第 29 条）：排版先按全部素材
 * 算完，再丢掉隐藏层的行——这个规则住在 shared 的纯函数里，服务端与预览
 * 共用同一份，不会两边走偏。
 */
export async function applyVisualLayerActionForStory(input: {
  storyId: number;
  userId: number;
  action: TimelineVisualLayerAction;
}): Promise<VisualClipEditResult> {
  return withVisualEditDocument(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "图层操作失败",
    },
    document => {
      const change = applyTimelineVisualLayerAction({
        items: document.items,
        overlays: document.overlays ?? [],
        state: document.visualLayerState ?? null,
        action: input.action,
      });
      return {
        status: "ok",
        document: {
          ...document,
          items: change.items,
          overlays: change.overlays,
          visualLayerState: change.state,
        },
      };
    }
  );
}

// ────────────────────────────────────────────────────────────────────
// 窄补丁命令（U6）
//
// 这些操作本来就不改 clip 的位置，只是以前顺手借了「整份写回」这根管子。
// 收窄之后每条命令的爆炸半径就是它自己那一个镜头。
// ────────────────────────────────────────────────────────────────────

/** 把某个镜头放进或移出时间线。 */
export async function setShotIncludedForStory(input: {
  storyId: number;
  userId: number;
  stableShotId: string;
  included: boolean;
}): Promise<VisualClipEditResult> {
  return withVisualEditDocument(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "更新镜头失败",
    },
    document => {
      if (
        !document.items.some(item => item.stableShotId === input.stableShotId)
      ) {
        return { status: "error", message: "当前镜头不在时间线上" };
      }
      return {
        status: "ok",
        document: {
          ...document,
          items: document.items.map(item =>
            item.stableShotId === input.stableShotId
              ? { ...item, included: input.included }
              : item
          ),
        },
      };
    }
  );
}

/** 相邻交换：把某个镜头往前或往后挪一位。 */
export async function moveShotOrderForStory(input: {
  storyId: number;
  userId: number;
  stableShotId: string;
  direction: -1 | 1;
}): Promise<VisualClipEditResult> {
  return withVisualEditDocument(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "调整顺序失败",
    },
    document => {
      const ordered = [...document.items].sort(
        (left, right) => left.position - right.position
      );
      const index = ordered.findIndex(
        item => item.stableShotId === input.stableShotId
      );
      const target = index + input.direction;
      if (index < 0) return { status: "error", message: "当前镜头不在时间线上" };
      if (target < 0 || target >= ordered.length) {
        return { status: "error", message: "已经到头了" };
      }
      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      return {
        status: "ok",
        document: {
          ...document,
          items: ordered.map((item, position) => ({ ...item, position })),
        },
      };
    }
  );
}

/** 拖放重排：把源镜头挪到目标镜头所在的位置。 */
export async function reorderShotToTargetForStory(input: {
  storyId: number;
  userId: number;
  sourceShotId: string;
  targetShotId: string;
}): Promise<VisualClipEditResult> {
  return withVisualEditDocument(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "调整顺序失败",
    },
    document => {
      const ordered = [...document.items].sort(
        (left, right) => left.position - right.position
      );
      const sourceIndex = ordered.findIndex(
        item => item.stableShotId === input.sourceShotId
      );
      const targetIndex = ordered.findIndex(
        item => item.stableShotId === input.targetShotId
      );
      if (sourceIndex < 0 || targetIndex < 0) {
        return { status: "error", message: "镜头不在时间线上" };
      }
      if (sourceIndex === targetIndex) {
        return { status: "ok", document, changed: false };
      }
      const [moved] = ordered.splice(sourceIndex, 1);
      ordered.splice(targetIndex, 0, moved);
      return {
        status: "ok",
        document: {
          ...document,
          items: ordered.map((item, position) => ({ ...item, position })),
        },
      };
    }
  );
}

/** 把所有镜头重新放回时间线并按顺序编号。 */
export async function includeAllShotsForStory(input: {
  storyId: number;
  userId: number;
}): Promise<VisualClipEditResult> {
  return withVisualEditDocument(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "恢复镜头失败",
    },
    document => ({
      status: "ok",
      document: {
        ...document,
        items: document.items.map((item, position) => ({
          ...item,
          included: true,
          position,
        })),
      },
    })
  );
}

/** 移除某个镜头内部的一个视频片段。 */
export async function removeInnerVideoClipForStory(input: {
  storyId: number;
  userId: number;
  stableShotId: string;
  clipId: string;
}): Promise<VisualClipEditResult> {
  return withVisualEditDocument(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "移除视频片段失败",
    },
    document => {
      const sourceItem = document.items.find(
        item => item.stableShotId === input.stableShotId
      );
      const sourceClips = sourceItem?.visualClips ?? [];
      if (!sourceItem || !sourceClips.some(clip => clip.id === input.clipId)) {
        return { status: "error", message: "找不到要移除的视频片段" };
      }
      return {
        status: "ok",
        document: {
          ...document,
          items: document.items.map(item => {
            if (item.stableShotId !== input.stableShotId) return item;
            const visualClips = sourceClips.filter(
              clip => clip.id !== input.clipId
            );
            return {
              ...item,
              visualClips,
              // 最后一个内部片段被移除后，「用片段替代主画面」必须回落，
              // 否则镜头会变成一块空白。
              visualClipsReplacePrimary:
                visualClips.length > 0 && item.visualClipsReplacePrimary,
            };
          }),
        },
      };
    }
  );
}
