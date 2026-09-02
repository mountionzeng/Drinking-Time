/**
 * 多轨剪辑的唯一写入口。
 *
 * 以前客户端要移动一个素材，必须自己重建整份 items 数组，再连同 expectedVersion
 * 整份覆盖回来：服务端无从知道用户想动哪一个 clip，也就无法验证「只有它该动」；
 * 客户端拿着的版本号一旦被别处的自动保存顶掉，整次拖动就悄悄回滚。
 *
 * 这里改成服务端自己读—改—写：调用方只说「哪个 clip、去哪条轨、去哪一帧」。
 */
import { createHash, randomUUID } from "node:crypto";
import type {
  VisualEditOperationRef,
  VisualEditReceipt,
} from "../../shared/visualEditReceipt";
import type {
  StoryTimelineImageTextOverlay,
  StoryTimelineItem,
  StoryTimelineOverlay,
  TimelineTransform,
} from "../../shared/storyMaterial";
import { withTimelineDurationMs } from "../../shared/storyMaterial";
import {
  insertVisualImageClip,
  moveVisualClip,
  shotClipId,
  visualTrackId,
  removeVisualClip,
  type InsertVisualImageClipInput,
  type VisualEditDocument,
} from "../../shared/visualClipModel";
import type { VisualObjectRef } from "../../shared/visualObject";
import type { ImageClipClipboardSnapshot } from "../../shared/visualObjectClipboard";
import {
  deleteVisualObjectReference,
  pasteImageClipboardSnapshot,
} from "../../shared/visualObjectOperations";
import { buildTimelineLayout } from "../../shared/timelineLayout";
import {
  applyTimelineVideoEdit,
  splitOwnedTimelineVisualClip,
  type TimelineVideoEditInput,
} from "../../shared/timelineVisualClips";
import {
  applyTimelineVisualLayerAction,
  hiddenTimelineVisualLayers,
  planExtractedFrameTargetLayer,
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
import {
  loadAuthorizedStoryImage,
  loadOwnedStory,
  loadOwnedStoryVisualAggregate,
  loadStoryVideoSources,
  saveStoryVisualAggregateCas,
  saveStoryVisualTimelineCas,
  visualDocumentFromTimeline,
} from "../persistence/storyVisualPersistence";
import {
  consumeVisualEditUndo,
  findVisualEditUndo,
  latestAvailableVisualEditUndo,
  publicVisualEditReceipt,
  rebaseLatestVisualEditUndoAfterVersion,
  rebaseLatestVisualEditUndoAfterVersions,
  recordVisualEditUndo,
} from "./visualEditUndoJournal";
import { getStoryMaterialState } from "./storyMaterials";
import { normalizeLegacyOverlay } from "../../shared/legacyOverlayNormalization";
import { getStoryRevision, prepareStoryBody } from "./storySync";
import { shotIdentityFromShot } from "../../shared/shotIdentity";
import { isVisualEditSessionEpochAllowed } from "./visualEditSessionRegistry";
import { createKeyedSerialLock } from "../utils/keyedSerialLock";

export type VisualClipEditResult =
  | {
      status: "ok";
      timelineVersion: number;
      /** false 表示目标位置与当前一致，没有写入。 */
      changed: boolean;
      /** 打标命令返回新锚点 id，其余命令没有。 */
      anchorId?: string;
      receipt?: VisualEditReceipt;
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
  const aggregate = await loadOwnedStoryVisualAggregate({ storyId, userId });
  if (!aggregate) return { error: "故事不存在或无权访问" };
  const row = aggregate.timeline;
  if (!row) return { error: "这个故事还没有时间线" };
  const document = visualDocumentFromTimeline(row);
  if (!document) return { error: "时间线数据异常，无法编辑" };
  return {
    document,
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
type VisualEditMutation = (document: VisualEditDocument) =>
  | {
      status: "ok";
      document: VisualEditDocument;
      changed?: boolean;
      anchorId?: string;
    }
  | { status: "error"; message: string };

const CONFLICT_RETRY_LIMIT = 1;

type LegacyOverlayScope =
  | { kind: "sources"; sourceStableShotIds: readonly string[] }
  | { kind: "overlays"; overlayIds: readonly string[] }
  | { kind: "all" };

function storyShotBindings(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const shots = (body as Record<string, unknown>).shots;
  return Array.isArray(shots)
    ? shots.filter(
        (shot): shot is Record<string, unknown> =>
          !!shot && typeof shot === "object" && !Array.isArray(shot)
      )
    : [];
}

async function normalizeLegacyWorkingSet(input: {
  storyId: number;
  userId: number;
  storyBody: unknown;
  document: VisualEditDocument;
  scope: LegacyOverlayScope;
}): Promise<
  | { status: "ok"; document: VisualEditDocument; changed: boolean }
  | { status: "error"; message: string }
> {
  const overlays = input.document.overlays ?? [];
  let selected: StoryTimelineOverlay[];
  if (input.scope.kind === "all") {
    selected = overlays;
  } else if (input.scope.kind === "overlays") {
    const overlayIds = input.scope.overlayIds;
    selected = overlays.filter(overlay => overlayIds.includes(overlay.id));
  } else {
    const sourceStableShotIds = input.scope.sourceStableShotIds;
    selected = overlays.filter(overlay =>
      sourceStableShotIds.includes(overlay.sourceStableShotId)
    );
  }
  if (selected.length === 0) {
    return { status: "ok", document: input.document, changed: false };
  }

  const takes = await loadStoryVideoSources({
    storyId: input.storyId,
    userId: input.userId,
  });
  let document = input.document;
  for (const selectedOverlay of selected) {
    const normalized = normalizeLegacyOverlay({
      overlayId: selectedOverlay.id,
      sourceStableShotId: selectedOverlay.sourceStableShotId,
      expectedVideoUrl: selectedOverlay.videoUrl,
      storyShots: storyShotBindings(input.storyBody),
      document,
      takes: takes.map(take => ({
        id: take.id,
        stableShotId: take.stableShotId,
        videoUrl: take.videoUrl,
      })),
    });
    if (normalized.status === "error") {
      return {
        status: "error",
        message: `无法归一遗留覆盖层：${normalized.message}`,
      };
    }
    document = normalized.document;
  }
  return { status: "ok", document, changed: document !== input.document };
}

async function withVisualEditDocument(
  input: {
    storyId: number;
    userId: number;
    failureMessage: string;
    /** 撤销本身不进撤销栈，否则一次 Cmd+Z 会在两个状态之间来回跳。 */
    recordUndo?: boolean;
    operation?: VisualEditOperationRef;
    commandPayload?: unknown;
    lockHeld?: boolean;
    retryConflicts?: boolean;
    normalizeLegacy?: (document: VisualEditDocument) => LegacyOverlayScope;
  },
  mutate: VisualEditMutation
): Promise<VisualClipEditResult> {
  if (!input.lockHeld) {
    return withVisualEditServiceLock(input.storyId, input.userId, () =>
      withVisualEditDocument({ ...input, lockHeld: true }, mutate)
    );
  }
  if (
    !(await loadOwnedStory({
      storyId: input.storyId,
      userId: input.userId,
    }))
  ) {
    return {
      status: "error",
      error: "故事不存在或无权访问",
      errorKind: "invalid",
    };
  }
  const operation = input.operation ?? {
    editorSessionEpoch: "legacy",
    operationId: randomUUID(),
  };
  if (
    !isVisualEditSessionEpochAllowed({
      storyId: input.storyId,
      userId: input.userId,
      editorSessionEpoch: operation.editorSessionEpoch,
    })
  ) {
    return {
      status: "error",
      error: "这个剪辑会话已经失效，请刷新后重试",
      errorKind: "invalid",
    };
  }
  const commandDigest = createHash("sha256")
    .update(JSON.stringify(input.commandPayload ?? operation.operationId))
    .digest("hex");
  const replay = findVisualEditUndo({
    storyId: input.storyId,
    userId: input.userId,
    operation,
  });
  if (replay) {
    if (replay.commandDigest !== commandDigest) {
      return {
        status: "error",
        error: "操作标识已用于另一条命令",
        errorKind: "invalid",
      };
    }
    if (replay.status !== "available") {
      return {
        status: "error",
        error: "这条操作已经撤销，不能再次重放",
        errorKind: "invalid",
      };
    }
    return {
      status: "ok",
      timelineVersion: replay.afterTimelineVersion,
      changed: true,
      ...(replay.undoEvicted
        ? {}
        : { receipt: publicVisualEditReceipt(replay) }),
    };
  }
  for (let attempt = 0; ; attempt += 1) {
    // CAS 重试必须重新读取 Story，不能用旧 body 验证新 Timeline。
    const aggregate = await loadOwnedStoryVisualAggregate({
      storyId: input.storyId,
      userId: input.userId,
    });
    if (!aggregate) {
      return {
        status: "error",
        error: "故事不存在或无权访问",
        errorKind: "invalid",
      };
    }
    const story = aggregate.story;
    const row = aggregate.timeline;
    const document = row ? visualDocumentFromTimeline(row) : null;
    const loaded:
      | { document: VisualEditDocument; version: number }
      | { error: string } = !row
      ? ({ error: "这个故事还没有时间线" } as const)
      : !document
        ? ({ error: "时间线数据异常，无法编辑" } as const)
        : { document, version: row.version };
    if ("error" in loaded) {
      return { status: "error", error: loaded.error, errorKind: "invalid" };
    }

    const normalized = input.normalizeLegacy
      ? await normalizeLegacyWorkingSet({
          storyId: input.storyId,
          userId: input.userId,
          storyBody: story.body,
          document: loaded.document,
          scope: input.normalizeLegacy(loaded.document),
        })
      : {
          status: "ok" as const,
          document: loaded.document,
          changed: false,
        };
    if (normalized.status === "error") {
      return {
        status: "error",
        error: normalized.message,
        errorKind: "invalid",
      };
    }
    const result = mutate(normalized.document);
    if (result.status === "error") {
      return { status: "error", error: result.message, errorKind: "invalid" };
    }
    // Planner 自身虽是 no-op，前置归一仍是同一命令的一部分，必须落库。
    if (result.changed === false && !normalized.changed) {
      return { status: "ok", timelineVersion: loaded.version, changed: false };
    }

    try {
      const saved = await saveStoryVisualTimelineCas({
        storyId: input.storyId,
        userId: input.userId,
        // 版本来自刚刚这次服务端读取，客户端不再持有版本号。
        expectedVersion: loaded.version,
        document: result.document,
      });
      if (input.recordUndo !== false) {
        // 写成功之后才记，否则失败的命令会在撤销栈里留下一格空转。
        const receipt = recordVisualEditUndo({
          storyId: input.storyId,
          userId: input.userId,
          operation,
          before: loaded.document,
          beforeTimelineVersion: loaded.version,
          afterTimelineVersion: saved.version,
          commandDigest,
        });
        return {
          status: "ok",
          timelineVersion: saved.version,
          changed: true,
          ...(result.anchorId === undefined
            ? {}
            : { anchorId: result.anchorId }),
          receipt: publicVisualEditReceipt(receipt),
        };
      }
      return {
        status: "ok",
        timelineVersion: saved.version,
        changed: true,
        ...(result.anchorId === undefined ? {} : { anchorId: result.anchorId }),
      };
    } catch (error) {
      if (
        isVersionConflict(error) &&
        input.retryConflicts !== false &&
        attempt < CONFLICT_RETRY_LIMIT
      ) {
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
    normalizeLegacy?: (
      document: VisualEditDocument,
      shotsById: ReadonlyMap<string, TimelineResolverShot>
    ) => LegacyOverlayScope;
  },
  planner: TimelinePlanner
): Promise<VisualClipEditResult> {
  const shotsById = input.needsShotMaterials
    ? await loadResolverShots(input.storyId, input.userId)
    : new Map<string, TimelineResolverShot>();

  return withVisualEditDocument(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: input.failureMessage,
      ...(input.normalizeLegacy
        ? {
            normalizeLegacy: (document: VisualEditDocument) =>
              input.normalizeLegacy!(document, shotsById),
          }
        : {}),
    },
    document => {
      const rows = buildTimelineLayout(document.items);
      const plan = planner({ document, rows, shotsById });
      if (plan.kind !== "ok") return { status: "error", message: plan.reason };
      return {
        status: "ok",
        document: { ...document, items: plan.items },
        ...(plan.anchorId === undefined ? {} : { anchorId: plan.anchorId }),
      };
    }
  );
}

export async function moveVisualClipForStory(input: {
  storyId: number;
  userId: number;
  clipId: string;
  toTrackId: string;
  toStartFrame: number;
}): Promise<VisualClipEditResult> {
  const legacyOverlayId = input.clipId.startsWith("overlay:")
    ? input.clipId.slice("overlay:".length)
    : null;
  // A retry may observe the overlay after another writer has already
  // normalized it. Retain the exact canonical identity established by the
  // first attempt so the same user intent can continue against the fresh
  // Timeline instead of falling back to direct overlay mutation.
  let normalizedClipId: string | null = null;
  return withVisualEditDocument(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "移动没有保存成功",
      ...(legacyOverlayId
        ? {
            normalizeLegacy: (document: VisualEditDocument) => {
              const matching = (document.overlays ?? []).filter(
                overlay => overlay.id === legacyOverlayId
              );
              if (matching.length === 1) {
                normalizedClipId = shotClipId(matching[0].sourceStableShotId);
              }
              return {
                kind: "overlays" as const,
                overlayIds: [legacyOverlayId],
              };
            },
          }
        : {}),
    },
    document =>
      moveVisualClip(document, {
        clipId: normalizedClipId ?? input.clipId,
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
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "素材没有放置成功",
    },
    document => insertVisualImageClip(document, input.clip)
  );
}

export type ExtractedFramePlacementResult = VisualClipEditResult & {
  clipId?: string;
  targetLayer?: number;
};

/**
 * Place a durable extracted-frame asset immediately above the layer the user
 * operated on. Layer insertion and image placement share one timeline CAS, so
 * a hidden adjacent layer can never be shifted without the frame appearing.
 *
 * `clipId` is derived from the extraction request. If the timeline write
 * succeeded but the process died before its receipt was finalized, replaying
 * that request recognizes the existing block and leaves any later user move
 * untouched instead of dragging the frame back to its original position.
 */
export async function placeExtractedFrameForStory(input: {
  storyId: number;
  userId: number;
  clipId: string;
  imageId: number;
  imageUrl: string;
  label: string;
  timelineFrame: number;
  operationLayer: number;
}): Promise<ExtractedFramePlacementResult> {
  let targetLayer: number | undefined;
  const result = await withVisualEditDocument(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "抽帧没有放置成功",
    },
    document => {
      const existing = document.items
        .flatMap(item => item.imageClips ?? [])
        .find(clip => clip.id === input.clipId);
      if (existing) {
        if (existing.imageId !== input.imageId) {
          return {
            status: "error",
            message: "这个抽帧请求已绑定另一张仓库图片",
          };
        }
        targetLayer = existing.visualLayer;
        return { status: "ok", document, changed: false };
      }

      const layerPlan = planExtractedFrameTargetLayer({
        items: document.items,
        overlays: document.overlays,
        state: document.visualLayerState,
        operationLayer: input.operationLayer,
      });
      if (layerPlan.status === "error") {
        return {
          status: "error",
          message: "操作图层已不存在，请重新选择图层后抽帧",
        };
      }
      targetLayer = layerPlan.targetLayer;
      const placement = insertVisualImageClip(
        {
          items: layerPlan.change.items,
          overlays: layerPlan.change.overlays,
          visualLayerState: layerPlan.change.state,
        },
        {
          clipId: input.clipId,
          imageId: input.imageId,
          imageUrl: input.imageUrl,
          label: input.label,
          trackId: visualTrackId(layerPlan.targetLayer),
          startFrame: input.timelineFrame,
          durationFrames: 1,
        }
      );
      if (placement.status === "error") {
        return { status: "error", message: placement.message };
      }
      return {
        status: "ok",
        document: placement.document,
        changed: placement.changed || layerPlan.insertedLayer,
      };
    }
  );
  return result.status === "ok"
    ? { ...result, clipId: input.clipId, targetLayer }
    : result;
}

export async function removeVisualClipForStory(input: {
  storyId: number;
  userId: number;
  clipId: string;
}): Promise<VisualClipEditResult> {
  return withVisualEditDocument(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "素材没有删除成功",
    },
    document => removeVisualClip(document, input.clipId)
  );
}

function pastedImageClipId(input: {
  storyId: number;
  userId: number;
  pasteId: string;
}): string {
  const digest = createHash("sha256")
    .update(`${input.userId}:${input.storyId}:${input.pasteId}`)
    .digest("hex")
    .slice(0, 32);
  return `image-paste-${digest}`;
}

export type PasteVisualImageResult = VisualClipEditResult & {
  clipId?: string;
};

/**
 * Paste an immutable image snapshot after re-authorizing its warehouse asset.
 * The request identity becomes the clip identity, so a lost response can be
 * replayed without creating or moving a second block.
 */
export async function pasteVisualImageForStory(input: {
  storyId: number;
  userId: number;
  pasteId: string;
  snapshot: ImageClipClipboardSnapshot;
  targetFrame: number;
  targetLayer: number;
  operation?: VisualEditOperationRef;
}): Promise<PasteVisualImageResult> {
  const pasteId = input.pasteId.trim();
  if (!pasteId || pasteId.length > 160) {
    return {
      status: "error",
      error: "粘贴请求标识无效",
      errorKind: "invalid",
    };
  }
  if (
    !Number.isInteger(input.targetFrame) ||
    input.targetFrame < 0 ||
    !Number.isInteger(input.targetLayer) ||
    input.targetLayer < 0
  ) {
    return {
      status: "error",
      error: "粘贴位置无效",
      errorKind: "invalid",
    };
  }
  const image = await loadAuthorizedStoryImage({
    storyId: input.storyId,
    userId: input.userId,
    imageId: input.snapshot.imageId,
  });
  if (!image) {
    return {
      status: "error",
      error: "剪贴板图片已失效或不属于当前故事",
      errorKind: "invalid",
    };
  }
  const clipId = pastedImageClipId({
    storyId: input.storyId,
    userId: input.userId,
    pasteId,
  });
  const result = await withVisualEditDocument(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "图片粘贴失败",
      operation: input.operation,
      commandPayload: {
        kind: "pasteVisualImage",
        pasteId,
        snapshot: input.snapshot,
        targetFrame: input.targetFrame,
        targetLayer: input.targetLayer,
      },
    },
    document => {
      const existed = document.items.some(item =>
        item.imageClips?.some(clip => clip.id === clipId)
      );
      const plan = pasteImageClipboardSnapshot({
        document,
        storyId: input.storyId,
        snapshot: input.snapshot,
        newClipId: clipId,
        targetFrame: input.targetFrame,
        targetLayer: input.targetLayer,
        canonicalImageUrl: image.imageUrl,
      });
      if (plan.status === "error") {
        return { status: "error", message: plan.message };
      }
      if (existed && plan.changed) {
        return {
          status: "error",
          message: "这个粘贴请求已经用于另一个位置，请重新复制后粘贴",
        };
      }
      return plan;
    }
  );
  return result.status === "ok" ? { ...result, clipId } : result;
}

/** Delete only a canonical clip reference; full shots use the aggregate path. */
export async function deleteVisualObjectForStory(input: {
  storyId: number;
  userId: number;
  object: VisualObjectRef;
  operation?: VisualEditOperationRef;
}): Promise<VisualClipEditResult> {
  return withVisualEditDocument(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "素材删除失败",
      operation: input.operation,
      commandPayload: { kind: "deleteVisualObject", object: input.object },
    },
    document => {
      const result = deleteVisualObjectReference({
        document,
        object: input.object,
      });
      return result.status === "ok"
        ? result
        : { status: "error", message: result.message };
    }
  );
}

function splitOwnedVideoClipRightId(input: {
  storyId: number;
  userId: number;
  ownerStableShotId: string;
  clipId: string;
  cutFrame: number;
  operation: VisualEditOperationRef;
}): string {
  const digest = createHash("sha256")
    .update(
      [
        input.userId,
        input.storyId,
        input.operation.editorSessionEpoch,
        input.operation.operationId,
        input.ownerStableShotId,
        input.clipId,
        input.cutFrame,
      ].join(":")
    )
    .digest("hex")
    .slice(0, 32);
  return `owned-split-${digest}`;
}

export type SplitOwnedVideoClipForStoryResult = VisualClipEditResult & {
  rightClipId?: string;
};

/** Split a canonical owned video clip; Story identity/body are never written. */
export async function splitOwnedVideoClipForStory(input: {
  storyId: number;
  userId: number;
  ownerStableShotId: string;
  clipId: string;
  cutFrame: number;
  operation: VisualEditOperationRef;
}): Promise<SplitOwnedVideoClipForStoryResult> {
  const rightClipId = splitOwnedVideoClipRightId(input);
  const result = await withVisualEditDocument(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "视频片段拆分失败",
      operation: input.operation,
      commandPayload: {
        kind: "splitOwnedVideoClip",
        ownerStableShotId: input.ownerStableShotId,
        clipId: input.clipId,
        cutFrame: input.cutFrame,
      },
      normalizeLegacy: () => ({
        kind: "sources",
        sourceStableShotIds: [input.ownerStableShotId],
      }),
    },
    document => {
      const plan = splitOwnedTimelineVisualClip({
        items: document.items,
        ownerStableShotId: input.ownerStableShotId,
        clipId: input.clipId,
        cutFrame: input.cutFrame,
        rightClipId,
      });
      return plan.status === "ok"
        ? { status: "ok", document: { ...document, items: plan.items } }
        : { status: "error", message: plan.message };
    }
  );
  return result.status === "ok" ? { ...result, rightClipId } : result;
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
      normalizeLegacy: () => ({ kind: "all" }),
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
      normalizeLegacy: () => ({
        kind: "sources",
        sourceStableShotIds: [input.stableShotId],
      }),
    },
    document => {
      const rows = buildTimelineLayout(document.items);
      const sourceItem = document.items.find(
        item => item.stableShotId === input.stableShotId
      );
      if (!sourceItem) {
        return { status: "error", message: "镜头不在时间轴中" };
      }
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

      const needsLayerWrite = targetLayer != null;
      const items = needsLayerWrite
        ? plan.items.map(item =>
            item.stableShotId === input.stableShotId
              ? { ...item, visualLayer: targetLayer }
              : item
          )
        : plan.items;

      return {
        status: "ok",
        document: {
          ...document,
          items,
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
      normalizeLegacy: () => ({
        kind: "sources",
        sourceStableShotIds: [input.leftStableShotId, input.rightStableShotId],
      }),
    },
    ({ document, rows, shotsById }) =>
      planTimelineRollingTrim({
        items: document.items,
        rows,
        leftStableShotId: input.leftStableShotId,
        rightStableShotId: input.rightStableShotId,
        requestedBoundaryFrame: input.requestedBoundaryFrame,
        leftSourceLimitSec:
          shotsById.get(input.leftStableShotId)?.currentVideoDurationSec ??
          null,
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
      normalizeLegacy: () => ({
        kind: "sources",
        sourceStableShotIds: [input.leftStableShotId, input.rightStableShotId],
      }),
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
      normalizeLegacy: (document, shotsById) => {
        const rows = buildTimelineLayout(document.items);
        const winner = resolveTimelineFrameSource({
          rows,
          shotsById,
          ...(document.overlays === undefined
            ? {}
            : { overlays: document.overlays }),
          hiddenVisualLayers: Array.from(
            hiddenTimelineVisualLayers(document.visualLayerState)
          ),
          timelineFrame: input.timelineFrame,
        });
        return winner.kind === "source" &&
          winner.sourceType === "visual-clip" &&
          winner.sourceId.startsWith("overlay-")
          ? {
              kind: "overlays",
              overlayIds: [winner.sourceId.slice("overlay-".length)],
            }
          : { kind: "overlays", overlayIds: [] };
      },
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
      normalizeLegacy: () => ({
        kind: "sources",
        sourceStableShotIds: [input.stableShotId],
      }),
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
      normalizeLegacy: () => ({
        kind: "sources",
        sourceStableShotIds: [input.stableShotId],
      }),
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
      normalizeLegacy: () => ({ kind: "all" }),
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
      normalizeLegacy: () => ({
        kind: "sources",
        sourceStableShotIds: [input.stableShotId],
      }),
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
      normalizeLegacy: () => ({
        kind: "sources",
        sourceStableShotIds: [input.stableShotId],
      }),
    },
    document => {
      const ordered = [...document.items].sort(
        (left, right) => left.position - right.position
      );
      const index = ordered.findIndex(
        item => item.stableShotId === input.stableShotId
      );
      const target = index + input.direction;
      if (index < 0)
        return { status: "error", message: "当前镜头不在时间线上" };
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
      normalizeLegacy: () => ({
        kind: "sources",
        sourceStableShotIds: [input.sourceShotId],
      }),
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
      normalizeLegacy: () => ({ kind: "all" }),
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
      normalizeLegacy: () => ({
        kind: "sources",
        sourceStableShotIds: [input.stableShotId],
      }),
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

/** 改镜头的计划时长。只动这一个镜头的时长字段，不碰它的位置。 */
export async function setShotDurationForStory(input: {
  storyId: number;
  userId: number;
  stableShotId: string;
  durationMs: number;
}): Promise<VisualClipEditResult> {
  return withVisualEditDocument(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "更新镜头时长失败",
      normalizeLegacy: () => ({
        kind: "sources",
        sourceStableShotIds: [input.stableShotId],
      }),
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
              ? withTimelineDurationMs(item, input.durationMs)
              : item
          ),
        },
      };
    }
  );
}

/**
 * 改某张图片在镜头里的构图与文字层。
 *
 * 文字层为空时要把这张图的记录整条删掉，而不是留一个空对象——留着会让
 * imageTextOverlays 一直非空，导出时以为还有文字要画。
 */
export async function patchImageTransformForStory(input: {
  storyId: number;
  userId: number;
  stableShotId: string;
  imageId: number;
  transform: TimelineTransform;
  textOverlay: StoryTimelineImageTextOverlay | null;
}): Promise<VisualClipEditResult> {
  return withVisualEditDocument(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "更新图片构图失败",
      normalizeLegacy: () => ({
        kind: "sources",
        sourceStableShotIds: [input.stableShotId],
      }),
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
          items: document.items.map(item => {
            if (item.stableShotId !== input.stableShotId) return item;
            const imageTextOverlays = { ...(item.imageTextOverlays ?? {}) };
            if (input.textOverlay) {
              imageTextOverlays[String(input.imageId)] = input.textOverlay;
            } else {
              delete imageTextOverlays[String(input.imageId)];
            }
            return {
              ...item,
              imageTransforms: {
                ...(item.imageTransforms ?? {}),
                [String(input.imageId)]: input.transform,
              },
              imageClips: item.imageClips?.map(clip =>
                clip.imageId === input.imageId
                  ? { ...clip, transform: input.transform }
                  : clip
              ),
              imageTextOverlays:
                Object.keys(imageTextOverlays).length > 0
                  ? imageTextOverlays
                  : undefined,
            };
          }),
        },
      };
    }
  );
}

/** Replace the warehouse image behind one exact timeline image clip without
 * changing the clip's placement, duration, layer, transform, or identity. */
export async function replaceVisualImageClipImageForStory(input: {
  storyId: number;
  userId: number;
  stableShotId: string;
  clipId: string;
  expectedImageId: number;
  replacementImageId: number;
}): Promise<VisualClipEditResult> {
  const replacement = await loadAuthorizedStoryImage({
    storyId: input.storyId,
    userId: input.userId,
    imageId: input.replacementImageId,
  });
  if (!replacement) {
    return { status: "error", error: "候选图片不存在或无权操作", errorKind: "invalid" };
  }
  return withVisualEditDocument(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "采用局部修改候选失败",
    },
    document => {
      const owner = document.items.find(item => item.stableShotId === input.stableShotId);
      const clip = owner?.imageClips?.find(candidate => candidate.id === input.clipId);
      if (!owner || !clip || clip.imageId !== input.expectedImageId) {
        return { status: "error", message: "当前图片剪辑已经变化，请重新审阅候选" };
      }
      return {
        status: "ok",
        document: {
          ...document,
          items: document.items.map(item => {
            if (item.stableShotId !== input.stableShotId) return item;
            const imageTransforms = { ...(item.imageTransforms ?? {}) };
            const imageTextOverlays = { ...(item.imageTextOverlays ?? {}) };
            const oldKey = String(input.expectedImageId);
            const newKey = String(input.replacementImageId);
            if (imageTransforms[oldKey] && !imageTransforms[newKey]) {
              imageTransforms[newKey] = imageTransforms[oldKey];
            }
            if (imageTextOverlays[oldKey] && !imageTextOverlays[newKey]) {
              imageTextOverlays[newKey] = imageTextOverlays[oldKey];
            }
            const sourceStillUsed = item.imageClips?.some(candidate =>
              candidate.id !== input.clipId && candidate.imageId === input.expectedImageId
            );
            if (!sourceStillUsed) {
              delete imageTransforms[oldKey];
              delete imageTextOverlays[oldKey];
            }
            return {
              ...item,
              imageClips: item.imageClips?.map(candidate =>
                candidate.id === input.clipId
                  ? {
                      ...candidate,
                      imageId: replacement.id,
                      imageUrl: replacement.imageUrl,
                    }
                  : candidate
              ),
              imageTransforms:
                Object.keys(imageTransforms).length > 0 ? imageTransforms : undefined,
              imageTextOverlays:
                Object.keys(imageTextOverlays).length > 0 ? imageTextOverlays : undefined,
            };
          }),
        },
      };
    }
  );
}

/** Verify the exact immutable Preview target immediately before a paid edit.
 * This is deliberately separate from adoption's CAS: paying for a target that
 * has already moved is never useful, even if adoption would later reject it. */
export async function previewMaskedImageTargetIsCurrent(input: {
  storyId: number;
  userId: number;
  imageId: number;
  targetKind: "shot-primary" | "timeline-image-clip";
  stableShotId: string;
  clipId?: string | null;
}): Promise<boolean> {
  if (input.targetKind === "timeline-image-clip") {
    if (!input.clipId) return false;
    const loaded = await loadVisualEditDocument(input.storyId, input.userId);
    if ("error" in loaded) return false;
    const owner = loaded.document.items.find(
      item => item.stableShotId === input.stableShotId
    );
    return Boolean(
      owner?.imageClips?.some(
        clip => clip.id === input.clipId && clip.imageId === input.imageId
      )
    );
  }
  const image = await loadAuthorizedStoryImage({
    storyId: input.storyId,
    userId: input.userId,
    imageId: input.imageId,
  });
  return Boolean(image?.isCurrent && image.shotIdentity === input.stableShotId);
}

/**
 * 撤销上一次视觉剪辑命令。
 *
 * 客户端只说「撤销」——它不再持有、也不再写回任何 items 数组。
 * 图层顺序、层数、显隐和素材是同一份文档的一部分，所以一次撤销天然全部还原
 * （账本 extracted-frame-overlay-video 第 30 条由结构保证，不靠调用方自觉）。
 */
export async function undoVisualEditForStory(input: {
  storyId: number;
  userId: number;
  operation?: VisualEditOperationRef;
}): Promise<VisualClipEditResult> {
  return withVisualEditServiceLock(input.storyId, input.userId, async () => {
    if (
      input.operation &&
      !isVisualEditSessionEpochAllowed({
        storyId: input.storyId,
        userId: input.userId,
        editorSessionEpoch: input.operation.editorSessionEpoch,
      })
    ) {
      return {
        status: "error",
        error: "这个剪辑会话已经失效，不能撤销其中的操作",
        errorKind: "invalid",
      };
    }
    const entry = input.operation
      ? findVisualEditUndo({ ...input, operation: input.operation })
      : latestAvailableVisualEditUndo({
          ...input,
          editorSessionEpoch: "legacy",
        });
    if (!entry) {
      return {
        status: "error",
        error: "没有可撤销的剪辑操作",
        errorKind: "invalid",
      };
    }
    if (
      entry.status === "consumed" &&
      entry.undoResultTimelineVersion !== undefined
    ) {
      return {
        status: "ok",
        timelineVersion: entry.undoResultTimelineVersion,
        changed: true,
      };
    }
    if ("replayOnly" in entry) {
      return {
        status: "error",
        error: "这条操作已超出可撤销范围",
        errorKind: "invalid",
      };
    }
    const latest = latestAvailableVisualEditUndo({
      ...input,
      editorSessionEpoch: entry.editorSessionEpoch,
    });
    if (entry.status !== "available" || latest !== entry) {
      return {
        status: "error",
        error: "只能撤销当前最新的剪辑操作",
        errorKind: "invalid",
      };
    }
    const aggregate = await loadOwnedStoryVisualAggregate({
      storyId: input.storyId,
      userId: input.userId,
    });
    const current = aggregate?.timeline ?? null;
    if (!current || current.version !== entry.afterTimelineVersion) {
      return {
        status: "error",
        error: "时间线已变化，无法撤销这条操作",
        errorKind: "conflict",
      };
    }
    if (entry.kind === "aggregate") {
      const story = aggregate?.story ?? null;
      if (!story || getStoryRevision(story.body) !== entry.afterStoryRevision) {
        return {
          status: "error",
          error: "故事已变化，无法撤销这条操作",
          errorKind: "conflict",
        };
      }
      const body =
        story.body &&
        typeof story.body === "object" &&
        !Array.isArray(story.body)
          ? (story.body as Record<string, unknown>)
          : {};
      const shots = Array.isArray(body.shots)
        ? body.shots.filter((shot): shot is Record<string, unknown> =>
            Boolean(shot && typeof shot === "object" && !Array.isArray(shot))
          )
        : [];
      const currentFingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            shots: shots.map((shot, index) =>
              shotIdentityFromShot(shot, index)
            ),
            items: (current.items as StoryTimelineItem[]).map(
              item => item.stableShotId
            ),
          })
        )
        .digest("hex");
      if (currentFingerprint !== entry.identityFingerprint) {
        return {
          status: "error",
          error: "镜头身份已变化，无法撤销这条操作",
          errorKind: "conflict",
        };
      }
      try {
        const restoredBody = prepareStoryBody(
          entry.beforeStoryBody as Record<string, unknown>,
          entry.afterStoryRevision + 1,
          story.body
        );
        const saved = await saveStoryVisualAggregateCas({
          storyId: input.storyId,
          userId: input.userId,
          expectedStoryRevision: entry.afterStoryRevision,
          expectedTimelineVersion: entry.afterTimelineVersion,
          nextStoryBody: restoredBody,
          nextDocument: {
            items: entry.before.items,
            overlays: entry.before.overlays ?? [],
            ...(entry.before.visualLayerState === undefined
              ? {}
              : { visualLayerState: entry.before.visualLayerState }),
          },
        });
        const storyRevision = getStoryRevision(saved.story.body);
        consumeVisualEditUndo(entry, {
          timelineVersion: saved.timeline.version,
          storyRevision,
        });
        rebaseLatestVisualEditUndoAfterVersions({
          ...input,
          editorSessionEpoch: entry.editorSessionEpoch,
          afterTimelineVersion: saved.timeline.version,
          afterStoryRevision: storyRevision,
        });
        return {
          status: "ok",
          timelineVersion: saved.timeline.version,
          changed: true,
        };
      } catch (error) {
        return {
          status: "error",
          error: error instanceof Error ? error.message : "撤销失败",
          errorKind: "conflict",
        };
      }
    }
    const result = await withVisualEditDocument(
      {
        storyId: input.storyId,
        userId: input.userId,
        failureMessage: "撤销失败",
        recordUndo: false,
        lockHeld: true,
        retryConflicts: false,
      },
      () => ({ status: "ok", document: entry.before })
    );
    if (result.status === "ok") {
      consumeVisualEditUndo(entry, result.timelineVersion);
      rebaseLatestVisualEditUndoAfterVersion({
        ...input,
        editorSessionEpoch: entry.editorSessionEpoch,
        afterTimelineVersion: result.timelineVersion,
      });
    }
    return result;
  });
}

const visualEditServiceLock = createKeyedSerialLock<string>();
export async function withVisualEditServiceLock<T>(
  storyId: number,
  userId: number,
  action: () => Promise<T>
): Promise<T> {
  const key = `${userId}:${storyId}`;
  return visualEditServiceLock.run(key, action);
}

/** 改一段视频的入出点、速度、音量与构图。纯计算住在 shared，服务端只负责读写。 */
export async function updateVideoEditForStory(input: {
  storyId: number;
  userId: number;
  edit: TimelineVideoEditInput;
}): Promise<VisualClipEditResult> {
  return withVisualEditDocument(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: "更新视频剪辑失败",
      normalizeLegacy: () => ({
        kind: "sources",
        sourceStableShotIds: [input.edit.stableShotId],
      }),
    },
    document => {
      const edited = applyTimelineVideoEdit(document.items, input.edit);
      if (edited.status === "error") {
        return { status: "error", message: edited.message };
      }
      return {
        status: "ok",
        document: { ...document, items: edited.items },
      };
    }
  );
}

/**
 * 把「播放头停在第几毫秒」解析成「那一刻可见的是哪个镜头」。
 *
 * 用户说「把这里改一下」时，「这里」指的就是他正在看的那一帧。解析走
 * resolveTimelineVisualFrame——与预览、剪辑行和导出同一个入口，所以
 * 聊聊认定的那一镜，就是用户眼睛看到的那一镜，隐藏层规则也一并生效。
 */
export async function resolveShotAtPlayhead(input: {
  storyId: number;
  userId: number;
  playheadMs: number;
}): Promise<{
  stableShotId: string;
  sourceType: string;
  sourceId: string;
} | null> {
  const loaded = await loadVisualEditDocument(input.storyId, input.userId);
  if ("error" in loaded) return null;
  const rows = buildTimelineLayout(loaded.document.items);
  const shotsById = await loadResolverShots(input.storyId, input.userId);
  const resolution = resolveTimelineFrameSource({
    rows,
    shotsById,
    ...(loaded.document.overlays === undefined
      ? {}
      : { overlays: loaded.document.overlays }),
    hiddenVisualLayers: Array.from(
      hiddenTimelineVisualLayers(loaded.document.visualLayerState)
    ),
    timelineFrame: Math.round((Math.max(0, input.playheadMs) / 1000) * 30),
  });
  // 空档处没有可见素材，如实返回 null——不要硬猜最近的一镜，
  // 「这里什么都没有」本身就是有意义的回答。
  if (resolution.kind !== "source") return null;
  return {
    stableShotId: resolution.stableShotId,
    sourceType: resolution.sourceType,
    sourceId: resolution.sourceId,
  };
}

/** 没有显式选中素材时，把播放头那一镜补进选择上下文。 */
export async function withPlayheadShot<
  T extends { stableShotId?: string | null } | undefined,
>(
  storyId: number,
  userId: number,
  playheadMs: number,
  selectionContext: T
): Promise<T | (NonNullable<T> & { stableShotId: string })> {
  const shot = await resolveShotAtPlayhead({ storyId, userId, playheadMs });
  if (!shot) return selectionContext;
  return {
    ...((selectionContext ?? {}) as NonNullable<T>),
    stableShotId: shot.stableShotId,
  };
}
