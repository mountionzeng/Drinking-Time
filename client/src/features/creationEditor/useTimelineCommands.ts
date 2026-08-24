import { useCallback } from "react";
import type { TimelineVisualLayerAction } from "@shared/timelineVisualLayers";
import type {
  StoryTimelineImageTextOverlay,
  TimelineTransform,
} from "@shared/storyMaterial";
import { trpc } from "@/lib/trpc";
import {
  recordTimelineCommandUndo,
  trackCreationEditorOperation,
} from "./timelineUndoStore";

/**
 * 时间线领域命令的客户端。
 *
 * 以前这些操作的走法是：客户端跑 planner 算出整份 items，再连同 expectedVersion
 * 整份覆盖回服务端。服务端因此无从判断用户到底想动哪一个 clip，也就无法保证
 * 「只有它该动」——同一份坐标于是有了两个写入者。
 *
 * 现在客户端只说做什么：哪个镜头、哪个方向、几帧。位置、素材时长限制、
 * 「这一帧是哪个画面」全部由服务端自己取自己算，两边不会得出不同答案。
 *
 * 单独成文件而不是塞进 CreationEditorContext，是因为这确实是一层独立职责
 * （服务端命令的客户端），不是为了让某个文件的行数好看。
 */

export type TimelineCommandOutcome = {
  applied: boolean;
  reason?: string;
  anchorId?: string;
};

type TimelineWriteLock = {
  run<T extends TimelineCommandOutcome>(
    task: () => Promise<T>,
    blocked: T
  ): Promise<T>;
};

export type TimelineCommandDeps = {
  /** 当前故事；为空时所有命令直接返回未执行。 */
  activeStoryId: number | null;
  /** 写入成功后重新拉取权威状态。 */
  refetchStoryMaterial: () => Promise<unknown>;
  /** 串行化：上一步剪辑还在保存时不接受下一步。 */
  writeLock: TimelineWriteLock;
};

export function useTimelineCommands(deps: TimelineCommandDeps) {
  const moveShotGroupMut = trpc.creationAgent.moveShotGroup.useMutation();
  const moveShotSingleMut = trpc.creationAgent.moveShotSingle.useMutation();
  const rollingTrimMut = trpc.creationAgent.rollingTrimTimeline.useMutation();
  const detachMagnetMut = trpc.creationAgent.detachTimelineMagnet.useMutation();
  const addAnchorMut = trpc.creationAgent.addTimelineAnchor.useMutation();
  const removeAnchorMut = trpc.creationAgent.removeTimelineAnchor.useMutation();
  const trimShotMut = trpc.creationAgent.trimShot.useMutation();
  const layerActionMut = trpc.creationAgent.applyVisualLayerAction.useMutation();
  const setIncludedMut = trpc.creationAgent.setShotIncluded.useMutation();
  const moveOrderMut = trpc.creationAgent.moveShotOrder.useMutation();
  const reorderToTargetMut =
    trpc.creationAgent.reorderShotToTarget.useMutation();
  const includeAllMut = trpc.creationAgent.includeAllShots.useMutation();
  const removeInnerClipMut =
    trpc.creationAgent.removeInnerVideoClip.useMutation();
  const setShotDurationMut = trpc.creationAgent.setShotDuration.useMutation();
  const patchImageTransformMut =
    trpc.creationAgent.patchImageTransform.useMutation();
  const undoVisualEditMut = trpc.creationAgent.undoVisualEdit.useMutation();

  const { activeStoryId, refetchStoryMaterial, writeLock } = deps;

  const run = useCallback(
    async (
      invoke: (storyId: number) => Promise<{
        status: "ok" | "error";
        changed?: boolean;
        anchorId?: string;
        error?: string;
      }>,
      failureReason: string
    ): Promise<TimelineCommandOutcome> => {
      if (activeStoryId == null) {
        return { applied: false, reason: "故事尚未加载" };
      }
      const storyId = activeStoryId;
      return writeLock.run(
        async () =>
          trackCreationEditorOperation(
            storyId,
            (async (): Promise<TimelineCommandOutcome> => {
              try {
                const result = await invoke(storyId);
                if (result.status !== "ok") {
                  // 服务端已经把 conflict 与 invalid 分开，并把「刷新后重试」
                  // 写进 conflict 的文案里。原样透出去，不要吞成一句「失败」——
                  // 唯一写入口拒绝时用户必须知道下一步能做什么。
                  await refetchStoryMaterial();
                  return {
                    applied: false,
                    reason: result.error || failureReason,
                  };
                }
                if (result.changed !== false) {
                  // 只记一格占位：回退内容在服务端的撤销日志里。
                  // 图层与素材本来就是同一份文档，所以一次 Cmd+Z 天然全部还原。
                  recordTimelineCommandUndo(storyId);
                }
                await refetchStoryMaterial();
                return {
                  applied: true,
                  ...(result.anchorId === undefined
                    ? {}
                    : { anchorId: result.anchorId }),
                };
              } catch (error) {
                await refetchStoryMaterial();
                return {
                  applied: false,
                  reason:
                    error instanceof Error ? error.message : failureReason,
                };
              }
            })()
          ),
        { applied: false, reason: "上一步剪辑还在保存中" }
      );
    },
    [activeStoryId, refetchStoryMaterial, writeLock]
  );

  const moveTimelineGroup = useCallback(
    (sourceShotId: string, direction: "left" | "right", deltaFrames: number) =>
      run(
        storyId =>
          moveShotGroupMut.mutateAsync({
            storyId,
            sourceShotId,
            direction,
            deltaFrames,
          }),
        "批量移动失败"
      ),
    [moveShotGroupMut, run]
  );

  const moveTimelineShot = useCallback(
    (
      stableShotId: string,
      deltaFrames: number,
      snapThresholdFrames?: number,
      visualLayer?: number
    ) =>
      // 横向位移、换层与遗留 overlay 迁移由服务端在一次写入里完成，
      // 客户端不再自己拼 items、也不再自己判断该不该删 overlay。
      run(
        storyId =>
          moveShotSingleMut.mutateAsync({
            storyId,
            stableShotId,
            deltaFrames,
            ...(snapThresholdFrames === undefined
              ? {}
              : { snapThresholdFrames }),
            ...(visualLayer === undefined ? {} : { toVisualLayer: visualLayer }),
          }),
        "移动镜头失败"
      ),
    [moveShotSingleMut, run]
  );

  const addTimelineAnchorAtFrame = useCallback(
    (timelineFrame: number) =>
      // 「这一帧是哪个画面」改由服务端解析，隐藏层规则一并生效。
      run(
        storyId => addAnchorMut.mutateAsync({ storyId, timelineFrame }),
        "打标失败"
      ),
    [addAnchorMut, run]
  );

  const removeTimelineAnchorFromShot = useCallback(
    (stableShotId: string, anchorId: string) =>
      run(
        storyId =>
          removeAnchorMut.mutateAsync({ storyId, stableShotId, anchorId }),
        "取消锚点失败"
      ),
    [removeAnchorMut, run]
  );

  const trimTimelineItemEdge = useCallback(
    (
      stableShotId: string,
      edge: "start" | "end",
      requestedBoundaryFrame: number
    ) =>
      run(
        storyId =>
          trimShotMut.mutateAsync({
            storyId,
            stableShotId,
            edge,
            requestedBoundaryFrame,
          }),
        "裁剪失败"
      ),
    [run, trimShotMut]
  );

  const rollTimelineJoin = useCallback(
    (
      leftStableShotId: string,
      rightStableShotId: string,
      requestedBoundaryFrame: number
    ) =>
      // 素材时长限制由服务端从 getStoryMaterialState 自己取，客户端不再传。
      run(
        storyId =>
          rollingTrimMut.mutateAsync({
            storyId,
            leftStableShotId,
            rightStableShotId,
            requestedBoundaryFrame,
          }),
        "滚动剪辑失败"
      ),
    [rollingTrimMut, run]
  );

  const detachTimelineMagnet = useCallback(
    (leftStableShotId: string, rightStableShotId: string) =>
      run(
        storyId =>
          detachMagnetMut.mutateAsync({
            storyId,
            leftStableShotId,
            rightStableShotId,
          }),
        "取消吸附失败"
      ),
    [detachMagnetMut, run]
  );

  const manageTimelineVisualLayer = useCallback(
    async (action: TimelineVisualLayerAction) => {
      const outcome = await run(
        storyId => layerActionMut.mutateAsync({ storyId, action }),
        "图层操作失败"
      );
      // 图层操作的调用方一直靠抛错来显示失败，保持原样。
      if (!outcome.applied) throw new Error(outcome.reason ?? "图层操作失败");
    },
    [layerActionMut, run]
  );

  const addShotToTimeline = useCallback(
    (stableShotId: string) =>
      run(
        storyId =>
          setIncludedMut.mutateAsync({ storyId, stableShotId, included: true }),
        "加入时间线失败"
      ),
    [run, setIncludedMut]
  );

  const removeShotFromTimeline = useCallback(
    (stableShotId: string) =>
      run(
        storyId =>
          setIncludedMut.mutateAsync({ storyId, stableShotId, included: false }),
        "移出时间线失败"
      ),
    [run, setIncludedMut]
  );

  const moveShotInTimeline = useCallback(
    (stableShotId: string, direction: -1 | 1) =>
      run(
        storyId =>
          moveOrderMut.mutateAsync({ storyId, stableShotId, direction }),
        "调整顺序失败"
      ),
    [moveOrderMut, run]
  );

  const reorderShotInTimeline = useCallback(
    (sourceShotId: string, targetShotId: string) =>
      run(
        storyId =>
          reorderToTargetMut.mutateAsync({
            storyId,
            sourceShotId,
            targetShotId,
          }),
        "调整顺序失败"
      ),
    [reorderToTargetMut, run]
  );

  const resetTimelineShots = useCallback(
    () => run(storyId => includeAllMut.mutateAsync({ storyId }), "恢复镜头失败"),
    [includeAllMut, run]
  );

  const removeTimelineVideoClip = useCallback(
    async (input: { stableShotId: string; clipId: string }) => {
      const outcome = await run(
        storyId =>
          removeInnerClipMut.mutateAsync({
            storyId,
            stableShotId: input.stableShotId,
            clipId: input.clipId,
          }),
        "移除视频片段失败"
      );
      if (!outcome.applied) {
        throw new Error(outcome.reason ?? "移除视频片段失败");
      }
    },
    [removeInnerClipMut, run]
  );

  const setTimelineShotDuration = useCallback(
    async (stableShotId: string, durationMs: number) => {
      const outcome = await run(
        storyId =>
          setShotDurationMut.mutateAsync({ storyId, stableShotId, durationMs }),
        "更新镜头时长失败"
      );
      if (!outcome.applied) {
        throw new Error(outcome.reason ?? "更新镜头时长失败");
      }
    },
    [run, setShotDurationMut]
  );

  const updateTimelineImageTransform = useCallback(
    async (input: {
      stableShotId: string;
      imageId: number;
      transform: TimelineTransform;
      textOverlay: StoryTimelineImageTextOverlay | null;
    }) => {
      const outcome = await run(
        storyId => patchImageTransformMut.mutateAsync({ storyId, ...input }),
        "更新图片构图失败"
      );
      if (!outcome.applied) {
        throw new Error(outcome.reason ?? "更新图片构图失败");
      }
    },
    [patchImageTransformMut, run]
  );

  /**
   * 撤销由服务端完成回退。这里刻意不走 run()——撤销不该把自己也记进撤销栈，
   * 而 run() 的职责之一正是记录快照。
   */
  const undoVisualEdit = useCallback(
    async (storyId: number): Promise<boolean> => {
      const result = await undoVisualEditMut.mutateAsync({ storyId });
      await refetchStoryMaterial();
      return result.status === "ok";
    },
    [refetchStoryMaterial, undoVisualEditMut]
  );

  return {
    undoVisualEdit,
    setTimelineShotDuration,
    updateTimelineImageTransform,
    manageTimelineVisualLayer,
    addShotToTimeline,
    removeShotFromTimeline,
    moveShotInTimeline,
    reorderShotInTimeline,
    resetTimelineShots,
    removeTimelineVideoClip,
    moveTimelineGroup,
    moveTimelineShot,
    addTimelineAnchorAtFrame,
    removeTimelineAnchorFromShot,
    trimTimelineItemEdge,
    rollTimelineJoin,
    detachTimelineMagnet,
  };
}
