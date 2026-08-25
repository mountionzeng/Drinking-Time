import { createHash } from "node:crypto";
import type { VisualObjectRef } from "../../shared/visualObject";
import {
  cloneVisualObjectClipboardSnapshot,
  snapshotVisualObjectForClipboard,
  type VisualObjectClipboardSnapshot,
  type StoryShotClipboardSnapshot,
} from "../../shared/visualObjectClipboard";
import {
  deleteStoryShotAggregate,
  pasteStoryShotClipboardSnapshot,
} from "../../shared/visualObjectOperations";
import { materializeAbsolutePlacements } from "../../shared/visualClipModel";
import { normalizeLegacyOverlay } from "../../shared/legacyOverlayNormalization";
import type { VisualEditOperationRef, VisualEditReceipt } from "../../shared/visualEditReceipt";
import { splitTimelineItem } from "../../shared/timelineEditing";
import { buildTimelineLayout } from "../../shared/timelineLayout";
import { splitStoryShotAtIndex } from "../../shared/storyShotEditing";
import { shotIdentityFromShot } from "../../shared/shotIdentity";
import { getGeneratedImageById, getStoryById, getStoryVideoTakes, getVideoTakeRangeById } from "../db";
import { getStoryMaterialState } from "./storyMaterials";
import { runStoryTimelineCommand, type StoryTimelineCommandContext } from "./storyTimelineEditing";
import type { LegacyOverlayCommandTarget } from "./storyTimelineEditing";
import {
  findVisualEditUndo,
  publicVisualEditReceipt,
  recordAggregateVisualEditUndo,
} from "./visualEditUndoJournal";
import { withVisualEditServiceLock } from "./visualClipEditing";
import { isVisualEditSessionEpochAllowed } from "./visualEditSessionRegistry";

const MAX_CLIPBOARDS_PER_SCOPE = 12;
type ClipboardEntry = {
  clipboardId: string;
  userId: number;
  storyId: number;
  editorSessionEpoch: string;
  snapshot: VisualObjectClipboardSnapshot;
};
const clipboards = new Map<string, ClipboardEntry[]>();
const clipboardScope = (userId: number, storyId: number, epoch: string) =>
  `${userId}:${storyId}:${epoch}`;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function deterministicId(prefix: string, input: object): string {
  return `${prefix}-${digest(input).slice(0, 32)}`;
}

function shotsOf(body: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(body.shots)
    ? body.shots.filter(
        (shot): shot is Record<string, unknown> =>
          Boolean(shot && typeof shot === "object" && !Array.isArray(shot))
      )
    : [];
}

export type StoryVisualObjectEditResult =
  | {
      status: "ok";
      changed: boolean;
      storyRevision: number;
      timelineVersion: number;
      receipt?: VisualEditReceipt;
      stableShotId?: string;
      rightStableShotId?: string;
      selectedStableShotId?: string;
    }
  | { status: "error"; error: string; errorKind: "invalid" | "conflict" };

export async function copyStoryVisualObject(input: {
  storyId: number;
  userId: number;
  editorSessionEpoch: string;
  clipboardId: string;
  object: VisualObjectRef;
}) {
  return withVisualEditServiceLock(input.storyId, input.userId, () =>
    copyStoryVisualObjectUnlocked(input)
  );
}

async function copyStoryVisualObjectUnlocked(input: {
  storyId: number;
  userId: number;
  editorSessionEpoch: string;
  clipboardId: string;
  object: VisualObjectRef;
}): Promise<
  | { status: "ok"; clipboardId: string; snapshot: VisualObjectClipboardSnapshot }
  | { status: "error"; error: string }
> {
  if (
    !isVisualEditSessionEpochAllowed({
      storyId: input.storyId,
      userId: input.userId,
      editorSessionEpoch: input.editorSessionEpoch,
    })
  )
    return { status: "error", error: "这个剪辑会话已经失效，请刷新后重试" };
  const [material, story] = await Promise.all([
    getStoryMaterialState(input.storyId, input.userId),
    getStoryById(input.storyId, input.userId),
  ]);
  if (!material || !story) return { status: "error", error: "故事不存在或无权访问" };
  let document: StoryTimelineCommandContext["document"] = {
    items: material.timeline.items,
    overlays: material.timeline.overlays ?? [],
    ...(material.timeline.visualLayerState === undefined
      ? {}
      : { visualLayerState: material.timeline.visualLayerState }),
  };
  if (input.object.type === "story-shot") {
    const stableShotId = input.object.stableShotId;
    const overlays = (document.overlays ?? []).filter(
      overlay => overlay.sourceStableShotId === stableShotId
    );
    if (overlays.length) {
      const takes = await getStoryVideoTakes(input.storyId, input.userId);
      for (const overlay of overlays) {
        const normalized = normalizeLegacyOverlay({
          overlayId: overlay.id,
          sourceStableShotId: overlay.sourceStableShotId,
          expectedVideoUrl: overlay.videoUrl,
          storyShots: shotsOf(story.body as Record<string, unknown>),
          document,
          takes: takes.map(take => ({ id: take.id, stableShotId: take.stableShotId, videoUrl: take.videoUrl })),
        });
        if (normalized.status === "error")
          return { status: "error", error: `历史覆盖视频绑定异常：${normalized.message}` };
        document = normalized.document;
      }
    }
  }
  const snapshot = snapshotVisualObjectForClipboard({
    storyId: input.storyId,
    document,
    object: input.object,
    storyShots: shotsOf(
      story.body && typeof story.body === "object" && !Array.isArray(story.body)
        ? (story.body as Record<string, unknown>)
        : {}
    ),
  });
  if (!snapshot) return { status: "error", error: "找不到可复制的视觉对象" };
  const key = clipboardScope(input.userId, input.storyId, input.editorSessionEpoch);
  const entries = (clipboards.get(key) ?? []).filter(
    entry => entry.clipboardId !== input.clipboardId
  );
  entries.push({
    clipboardId: input.clipboardId,
    userId: input.userId,
    storyId: input.storyId,
    editorSessionEpoch: input.editorSessionEpoch,
    snapshot: cloneVisualObjectClipboardSnapshot(snapshot),
  });
  if (entries.length > MAX_CLIPBOARDS_PER_SCOPE)
    entries.splice(0, entries.length - MAX_CLIPBOARDS_PER_SCOPE);
  clipboards.set(key, entries);
  return {
    status: "ok",
    clipboardId: input.clipboardId,
    snapshot: cloneVisualObjectClipboardSnapshot(snapshot),
  };
}

function readClipboard(input: {
  storyId: number;
  userId: number;
  editorSessionEpoch: string;
  clipboardId: string;
}): VisualObjectClipboardSnapshot | null {
  return (
    clipboards
      .get(clipboardScope(input.userId, input.storyId, input.editorSessionEpoch))
      ?.find(entry => entry.clipboardId === input.clipboardId)?.snapshot ?? null
  );
}

async function authorizeStoryShotSnapshot(input: {
  storyId: number;
  userId: number;
  snapshot: StoryShotClipboardSnapshot;
}): Promise<StoryShotClipboardSnapshot | null> {
  const snapshot = cloneVisualObjectClipboardSnapshot(input.snapshot) as StoryShotClipboardSnapshot;
  if (snapshot.timeline.referencedImageId != null) {
    const image = await getGeneratedImageById(snapshot.timeline.referencedImageId);
    if (!image || image.storyId !== input.storyId || (image.userId != null && image.userId !== input.userId))
      return null;
  }
  const takes = await getStoryVideoTakes(input.storyId, input.userId);
  const takeById = new Map(takes.map(take => [take.id, take] as const));
  const takeRefs = [
    ...(snapshot.timeline.primaryVideoEdit
      ? [{ takeId: snapshot.timeline.primaryVideoEdit.takeId, rangeId: null }]
      : []),
    ...snapshot.timeline.visualClips.map(clip => ({ takeId: clip.takeId, rangeId: clip.rangeId })),
  ];
  for (const ref of takeRefs) {
    const take = takeById.get(ref.takeId);
    if (!take?.videoUrl) return null;
    if (ref.rangeId != null) {
      const range = await getVideoTakeRangeById(ref.rangeId, input.userId);
      if (!range || range.storyId !== input.storyId || range.takeId !== ref.takeId) return null;
    }
  }
  return {
    ...snapshot,
    timeline: {
      ...snapshot.timeline,
      visualClips: snapshot.timeline.visualClips.map(clip => ({
        ...clip,
        videoUrl: takeById.get(clip.takeId)!.videoUrl!,
      })),
    },
  };
}

type AggregateCommandInput = {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  payload: unknown;
  failureMessage: string;
  legacyOverlays?: readonly LegacyOverlayCommandTarget[];
  lockHeld?: boolean;
  planner: (context: StoryTimelineCommandContext) =>
    | { status: "error"; message: string }
    | { status: "ok"; value: { stableShotId?: string; rightStableShotId?: string; selectedStableShotId?: string }; storyBody: Record<string, unknown>; document: StoryTimelineCommandContext["document"] };
};

async function runAggregateCommand(input: AggregateCommandInput): Promise<StoryVisualObjectEditResult> {
  if (input.lockHeld) return runAggregateCommandUnlocked(input);
  return withVisualEditServiceLock(input.storyId, input.userId, () =>
    runAggregateCommandUnlocked(input)
  );
}

async function runAggregateCommandUnlocked(input: AggregateCommandInput): Promise<StoryVisualObjectEditResult> {
  if (
    !isVisualEditSessionEpochAllowed({
      storyId: input.storyId,
      userId: input.userId,
      editorSessionEpoch: input.operation.editorSessionEpoch,
    })
  )
    return {
      status: "error",
      error: "这个剪辑会话已经失效，请刷新后重试",
      errorKind: "invalid",
    };
  const commandDigest = digest(input.payload);
  const replay = findVisualEditUndo({ storyId: input.storyId, userId: input.userId, operation: input.operation });
  if (replay) {
    if (replay.kind !== "aggregate" || replay.commandDigest !== commandDigest)
      return { status: "error", error: "操作标识已用于另一条命令", errorKind: "invalid" };
    if (replay.status !== "available")
      return { status: "error", error: "这条操作已经撤销，不能再次重放", errorKind: "invalid" };
    return {
      status: "ok",
      changed: true,
      storyRevision: replay.afterStoryRevision,
      timelineVersion: replay.afterTimelineVersion,
      ...(replay.undoEvicted ? {} : { receipt: publicVisualEditReceipt(replay) }),
      ...(replay.commandResult ?? {}),
    };
  }
  const command = await runStoryTimelineCommand(
    {
      storyId: input.storyId,
      userId: input.userId,
      failureMessage: input.failureMessage,
      ...(input.legacyOverlays?.length ? { legacyOverlays: input.legacyOverlays } : {}),
    },
    input.planner
  );
  if (command.status === "error") return command;
  if (!command.changed)
    return { status: "ok", changed: false, storyRevision: command.storyRevision, timelineVersion: command.timelineVersion };
  const identityFingerprint = digest({
    shots: shotsOf(command.facts.after.storyBody).map((shot, index) => shotIdentityFromShot(shot, index)),
    items: command.facts.after.document.items.map(item => item.stableShotId),
  });
  const receipt = recordAggregateVisualEditUndo({
    storyId: input.storyId,
    userId: input.userId,
    operation: input.operation,
    beforeStoryBody: command.facts.before.storyBody,
    before: command.facts.before.document,
    beforeStoryRevision: command.facts.before.storyRevision,
    afterStoryRevision: command.facts.after.storyRevision,
    beforeTimelineVersion: command.facts.before.timelineVersion,
    afterTimelineVersion: command.facts.after.timelineVersion,
    commandDigest,
    identityFingerprint,
    commandResult: command.value as Readonly<Record<string, string>>,
  });
  return {
    status: "ok",
    changed: true,
    storyRevision: command.storyRevision,
    timelineVersion: command.timelineVersion,
    receipt: publicVisualEditReceipt(receipt),
    ...command.value,
  };
}

export async function pasteStoryVisualObject(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  clipboardId: string;
  targetFrame: number;
  targetLayer: number;
}): Promise<StoryVisualObjectEditResult> {
  return withVisualEditServiceLock(input.storyId, input.userId, () =>
    pasteStoryVisualObjectUnlocked(input)
  );
}

async function pasteStoryVisualObjectUnlocked(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  clipboardId: string;
  targetFrame: number;
  targetLayer: number;
}): Promise<StoryVisualObjectEditResult> {
  const payload = {
    kind: "paste-story-shot",
    clipboardId: input.clipboardId,
    targetFrame: input.targetFrame,
    targetLayer: input.targetLayer,
  };
  if (
    findVisualEditUndo({
      storyId: input.storyId,
      userId: input.userId,
      operation: input.operation,
    })
  ) {
    return runAggregateCommand({
      ...input,
      lockHeld: true,
      payload,
      failureMessage: "镜头粘贴失败",
      planner: () => ({ status: "error", message: "幂等重放不应再次执行 planner" }),
    });
  }
  const raw = readClipboard({ ...input, editorSessionEpoch: input.operation.editorSessionEpoch });
  if (!raw || raw.kind !== "story-shot")
    return { status: "error", error: "剪贴板已失效，请重新复制", errorKind: "invalid" };
  const snapshot = await authorizeStoryShotSnapshot({ ...input, snapshot: raw });
  if (!snapshot)
    return { status: "error", error: "剪贴板引用的素材已失效或无权访问", errorKind: "invalid" };
  const stableShotId = deterministicId("paste-shot", { ...input.operation, storyId: input.storyId });
  const ownedIds = snapshot.timeline.visualClips.map((_, index) =>
    deterministicId("paste-owned", { ...input.operation, storyId: input.storyId, index })
  );
  return runAggregateCommand({
    ...input,
    lockHeld: true,
    payload,
    failureMessage: "镜头粘贴失败",
    planner: context => {
      const plan = pasteStoryShotClipboardSnapshot({
        aggregate: { shots: shotsOf(context.storyBody), document: context.document },
        storyId: input.storyId,
        snapshot,
        newStableShotId: stableShotId,
        newOwnedClipIds: ownedIds,
        targetFrame: input.targetFrame,
        targetLayer: input.targetLayer,
      });
      return plan.status === "error"
        ? { status: "error", message: plan.message }
        : { status: "ok", value: { stableShotId }, storyBody: { ...context.storyBody, shots: plan.aggregate.shots }, document: plan.aggregate.document };
    },
  });
}

export async function deleteStoryVisualShot(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  stableShotId: string;
}): Promise<StoryVisualObjectEditResult> {
  return withVisualEditServiceLock(input.storyId, input.userId, () =>
    deleteStoryVisualShotUnlocked(input)
  );
}

async function deleteStoryVisualShotUnlocked(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  stableShotId: string;
}): Promise<StoryVisualObjectEditResult> {
  const material = await getStoryMaterialState(input.storyId, input.userId);
  const legacyOverlays = (material?.timeline.overlays ?? [])
    .filter(overlay => overlay.sourceStableShotId === input.stableShotId)
    .map(overlay => ({
      overlayId: overlay.id,
      sourceStableShotId: overlay.sourceStableShotId,
      expectedVideoUrl: overlay.videoUrl,
    }));
  return runAggregateCommand({
    ...input,
    lockHeld: true,
    payload: { kind: "delete-story-shot", stableShotId: input.stableShotId },
    failureMessage: "镜头删除失败",
    legacyOverlays,
    planner: context => {
      const beforeShots = shotsOf(context.storyBody);
      const deletedIndex = beforeShots.findIndex(
        (shot, index) => shotIdentityFromShot(shot, index) === input.stableShotId
      );
      const plan = deleteStoryShotAggregate({
        aggregate: { shots: beforeShots, document: context.document },
        stableShotId: input.stableShotId,
      });
      return plan.status === "error"
        ? { status: "error", message: plan.message }
        : {
            status: "ok",
            value: {
              selectedStableShotId: shotIdentityFromShot(
                plan.aggregate.shots[Math.min(deletedIndex, plan.aggregate.shots.length - 1)]!,
                Math.min(deletedIndex, plan.aggregate.shots.length - 1)
              ) ?? undefined,
            },
            storyBody: { ...context.storyBody, shots: plan.aggregate.shots },
            document: plan.aggregate.document,
          };
    },
  });
}

export async function splitStoryVisualShot(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  stableShotId: string;
  cutFrame: number;
}): Promise<StoryVisualObjectEditResult> {
  return withVisualEditServiceLock(input.storyId, input.userId, () =>
    splitStoryVisualShotUnlocked(input)
  );
}

async function splitStoryVisualShotUnlocked(input: {
  storyId: number;
  userId: number;
  operation: VisualEditOperationRef;
  stableShotId: string;
  cutFrame: number;
}): Promise<StoryVisualObjectEditResult> {
  const rightStableShotId = deterministicId("split-shot", { ...input.operation, storyId: input.storyId, stableShotId: input.stableShotId, cutFrame: input.cutFrame });
  const material = await getStoryMaterialState(input.storyId, input.userId);
  const legacyOverlays = (material?.timeline.overlays ?? [])
    .filter(overlay => overlay.sourceStableShotId === input.stableShotId)
    .map(overlay => ({ overlayId: overlay.id, sourceStableShotId: overlay.sourceStableShotId, expectedVideoUrl: overlay.videoUrl }));
  return runAggregateCommand({
    ...input,
    lockHeld: true,
    payload: { kind: "split-story-shot", stableShotId: input.stableShotId, cutFrame: input.cutFrame },
    failureMessage: "镜头拆分失败",
    legacyOverlays,
    planner: context => {
      const shots = shotsOf(context.storyBody);
      const baseDocument = materializeAbsolutePlacements(context.document);
      const shotIndex = shots.findIndex((shot, index) => shotIdentityFromShot(shot, index) === input.stableShotId);
      const itemIndex = baseDocument.items.findIndex(item => item.stableShotId === input.stableShotId);
      const row = buildTimelineLayout(baseDocument.items).find(candidate => candidate.item.stableShotId === input.stableShotId);
      if (shotIndex < 0 || itemIndex < 0 || !row) return { status: "error", message: "镜头不存在或已经更新" };
      const sourceItem = baseDocument.items[itemIndex];
      const timeline = splitTimelineItem({ item: sourceItem, startFrame: row.startFrame, cutFrame: input.cutFrame, leftStableShotId: input.stableShotId, rightStableShotId });
      if (timeline.kind === "blocked") return { status: "error", message: timeline.reason };
      const leftImages = (sourceItem.imageClips ?? []).filter(
        clip => (clip.timelineStartFrame ?? row.startFrame + clip.offsetFrames) < input.cutFrame
      ).map(clip => {
        const start = clip.timelineStartFrame ?? row.startFrame + clip.offsetFrames;
        return { ...clip, timelineStartFrame: start, offsetFrames: start - row.startFrame };
      });
      const rightImages = (sourceItem.imageClips ?? []).filter(
        clip => (clip.timelineStartFrame ?? row.startFrame + clip.offsetFrames) >= input.cutFrame
      ).map(clip => {
        const start = clip.timelineStartFrame ?? row.startFrame + clip.offsetFrames;
        return { ...clip, timelineStartFrame: start, offsetFrames: start - input.cutFrame };
      });
      const left = { ...timeline.left, imageClips: leftImages };
      const right = {
        ...timeline.right,
        imageClips: rightImages,
        visualClips: (timeline.right.visualClips ?? []).map((clip, index) => ({
          ...clip,
          id: deterministicId("split-owned", {
            ...input.operation,
            storyId: input.storyId,
            stableShotId: input.stableShotId,
            cutFrame: input.cutFrame,
            sourceClipId: clip.id,
            index,
          }),
          sourceStableShotId: rightStableShotId,
        })),
      };
      const story = splitStoryShotAtIndex({ shots, index: shotIndex, rightStableShotId, leftDurationMs: left.plannedDurationMs, rightDurationMs: right.plannedDurationMs });
      if (!story) return { status: "error", message: "镜头拆分失败" };
      const items = [...baseDocument.items.slice(0, itemIndex), left, right, ...baseDocument.items.slice(itemIndex + 1)].map((item, position) => ({ ...item, position }));
      return { status: "ok", value: { rightStableShotId }, storyBody: { ...context.storyBody, shots: story.shots }, document: { ...baseDocument, items } };
    },
  });
}

export function clearStoryVisualClipboardForTesting(): void {
  clipboards.clear();
}
