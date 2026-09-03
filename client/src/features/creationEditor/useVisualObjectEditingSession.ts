import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import {
  timelineFramesToMs,
  timelineOffsetMsToFrames,
} from "@shared/storyMaterial";
import {
  buildTimelineLayout,
  resolveTimelineVisualFrame,
} from "@shared/timelineLayout";
import type { VisualEditDocument } from "@shared/visualClipModel";
import { visualObjectRefKey, type VisualObjectRef } from "@shared/visualObject";
import type { VisualObjectCommand } from "@shared/visualObjectCapabilities";
import { snapshotVisualObjectForClipboard } from "@shared/visualObjectClipboard";

import type { SelectionState } from "@/features/storyAgent/types";
import type { StoryboardTimingRow } from "@/features/storyAgent/storyboardTiming";
import {
  creationTimelineShotId,
  type useCreationEditor,
} from "./CreationEditorContext";
import { createVisualObjectClipboardSession } from "./visualObjectClipboard";
import { activateTimelineUndoSession } from "./timelineUndoStore";

type CreationEditor = ReturnType<typeof useCreationEditor>;
type VisualSessionEditor = Pick<
  CreationEditor,
  | "editorSessionEpoch"
  | "visualEditSessionReady"
  | "activeStoryId"
  | "shots"
  | "setSelectedShotNo"
  | "copyStoryVisualObject"
  | "pasteStoryVisualObject"
  | "deleteStoryVisualShot"
  | "splitTimelineVideoClip"
  | "splitOwnedVideoClip"
  | "extractTimelineFrame"
  | "pasteVisualImage"
  | "deleteVisualObject"
  | "timelineItems"
  | "timelineOverlays"
  | "timelineVisualLayerState"
  | "addTimelineAnchorAtFrame"
>;

type VideoSourceAtFrame = {
  stableShotId: string;
  videoUrl: string;
  overlayId?: string;
  sourceStartSec: number;
  sourceEndSec: number;
};

type VisualCommandContext = {
  timelineFrame: number;
  visualLayer: number;
};

function createClientOperationId(prefix: string): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

export function visualClipboardTargetLayer(
  snapshot: { sourceLayer: number },
  requestedLayer?: number
): number {
  return requestedLayer ?? snapshot.sourceLayer;
}

export function clearVisualIntentIfCurrent<T extends object>(
  intents: Map<string, T>,
  key: string,
  operation: T
): void {
  if (intents.get(key) === operation) intents.delete(key);
}

export function visualPasteSuccessMessage(
  kind: "story-shot" | "image-clip"
): string {
  return kind === "story-shot" ? "镜头已粘贴" : "图片已粘贴";
}

export function visualEditingSessionIdentity(
  storyId: number | null,
  editorSessionEpoch: string
): string {
  return `story:${storyId ?? "none"}:epoch:${editorSessionEpoch}`;
}

export function useVisualObjectEditingSession(input: {
  editor: VisualSessionEditor;
  timings: readonly StoryboardTimingRow[];
  selectShot: (shotNo: number) => void;
  setActiveSelection: (selection: SelectionState | null) => void;
  seekTimeline: (atMs: number) => void;
  resolveVideoSource: (playheadMs: number) => VideoSourceAtFrame | null;
}) {
  const {
    editorSessionEpoch,
    visualEditSessionReady,
    activeStoryId,
    shots,
    setSelectedShotNo,
    copyStoryVisualObject: copyStoryVisualObjectCommand,
    pasteStoryVisualObject: pasteStoryVisualObjectCommand,
    deleteStoryVisualShot: deleteStoryVisualShotCommand,
    splitTimelineVideoClip,
    splitOwnedVideoClip,
    extractTimelineFrame,
    pasteVisualImage,
    deleteVisualObject,
    timelineItems,
    timelineOverlays,
    timelineVisualLayerState,
    addTimelineAnchorAtFrame,
  } = input.editor;
  const {
    timings,
    selectShot,
    setActiveSelection,
    seekTimeline,
    resolveVideoSource,
  } = input;

  const visualPasteIntentRef = useRef(
    new Map<string, { editorSessionEpoch: string; operationId: string }>()
  );
  const visualDeleteIntentRef = useRef(
    new Map<string, { editorSessionEpoch: string; operationId: string }>()
  );
  const visualSplitIntentRef = useRef(
    new Map<string, { editorSessionEpoch: string; operationId: string }>()
  );
  const renderedEditingStorySessionToken = useMemo(
    () =>
      Symbol(visualEditingSessionIdentity(activeStoryId, editorSessionEpoch)),
    [activeStoryId, editorSessionEpoch]
  );
  const committedEditingStorySessionTokenRef = useRef(
    renderedEditingStorySessionToken
  );
  const committedUndoStoryIdRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    committedEditingStorySessionTokenRef.current =
      renderedEditingStorySessionToken;
    if (
      activeStoryId != null &&
      committedUndoStoryIdRef.current !== activeStoryId
    ) {
      activateTimelineUndoSession(activeStoryId, editorSessionEpoch);
    }
    committedUndoStoryIdRef.current = activeStoryId;
  }, [activeStoryId, editorSessionEpoch, renderedEditingStorySessionToken]);
  const editingStorySessionKey = visualEditingSessionIdentity(
    activeStoryId,
    editorSessionEpoch
  );
  const visualClipboard = useMemo(
    () =>
      activeStoryId == null
        ? null
        : createVisualObjectClipboardSession({
            storyId: activeStoryId,
          }),
    [activeStoryId, editorSessionEpoch]
  );
  const storyClipboardIdRef = useRef<string | null>(null);
  const visualCopySequenceRef = useRef(0);
  useEffect(() => {
    visualPasteIntentRef.current.clear();
    visualDeleteIntentRef.current.clear();
    visualSplitIntentRef.current.clear();
    storyClipboardIdRef.current = null;
    return () => visualClipboard?.dispose();
  }, [visualClipboard]);
  const isEditingStorySessionCurrent = useCallback(
    () =>
      committedEditingStorySessionTokenRef.current ===
      renderedEditingStorySessionToken,
    [renderedEditingStorySessionToken]
  );
  const [visualClipboardVersion, setVisualClipboardVersion] = useState(0);
  const hasVisualClipboard = useMemo(
    () => visualClipboard?.read() != null,
    [visualClipboard, visualClipboardVersion]
  );
  const newVisualOperation = useCallback(
    () => ({
      editorSessionEpoch,
      operationId: createClientOperationId("visual"),
    }),
    [editorSessionEpoch]
  );

  const splitAtPlayhead = useCallback(
    async (playheadMs: number, selectedStableShotId?: string) => {
      const cutFrame = timelineOffsetMsToFrames(playheadMs);
      if (selectedStableShotId) {
        const selectedTiming = timings.find(
          timing => timing.stableShotId === selectedStableShotId
        );
        if (
          !selectedTiming ||
          cutFrame <= selectedTiming.startFrame ||
          cutFrame >= selectedTiming.startFrame + selectedTiming.durationFrames
        ) {
          throw new Error("切割位置不在所选镜头内部");
        }
        const intentKey = `${selectedStableShotId}:${cutFrame}`;
        const operation =
          visualSplitIntentRef.current.get(intentKey) ?? newVisualOperation();
        visualSplitIntentRef.current.set(intentKey, operation);
        const rightStableShotId = await splitTimelineVideoClip({
          stableShotId: selectedStableShotId,
          cutFrame,
          operation,
        });
        clearVisualIntentIfCurrent(
          visualSplitIntentRef.current,
          intentKey,
          operation
        );
        if (rightStableShotId && isEditingStorySessionCurrent()) {
          setActiveSelection({
            sourceType: "shot",
            sourceId: rightStableShotId,
            selectedText: "切割后的镜头",
            fullText: "切割后的镜头",
            storyId: activeStoryId,
            stableShotId: rightStableShotId,
          });
        }
        return;
      }
      const source = resolveVideoSource(playheadMs);
      if (!source) {
        throw new Error("当前帧没有可切割的视频，请先为这个镜头采用视频 Take");
      }
      const sourceDurationSec = source.sourceEndSec - source.sourceStartSec;
      if (sourceDurationSec <= 2 / 30) {
        throw new Error("当前视频片段太短，无法继续切割");
      }
      const intentKey = `${source.stableShotId}:${cutFrame}`;
      const operation =
        visualSplitIntentRef.current.get(intentKey) ?? newVisualOperation();
      visualSplitIntentRef.current.set(intentKey, operation);
      await splitTimelineVideoClip({
        stableShotId: source.stableShotId,
        cutFrame,
        operation,
        videoUrl: source.videoUrl,
        overlayId: source.overlayId,
      });
      clearVisualIntentIfCurrent(
        visualSplitIntentRef.current,
        intentKey,
        operation
      );
    },
    [
      activeStoryId,
      isEditingStorySessionCurrent,
      newVisualOperation,
      setActiveSelection,
      splitTimelineVideoClip,
      resolveVideoSource,
      timings,
    ]
  );

  const extractFrameAtTimelineFrame = useCallback(
    async (timelineFrame: number, operationLayer: number) =>
      extractTimelineFrame({ timelineFrame, operationLayer }),
    [extractTimelineFrame]
  );
  const extractFrameAtPlayhead = useCallback(
    async (playheadMs: number, operationLayer: number) =>
      extractFrameAtTimelineFrame(
        timelineOffsetMsToFrames(playheadMs),
        operationLayer
      ),
    [extractFrameAtTimelineFrame]
  );

  const canonicalVisualDocument = useMemo<VisualEditDocument>(
    () => ({
      items: timelineItems,
      overlays: timelineOverlays,
      visualLayerState: {
        count: timelineVisualLayerState.explicitCount,
        hidden: [...timelineVisualLayerState.hidden],
      },
    }),
    [timelineItems, timelineOverlays, timelineVisualLayerState]
  );
  const copyVisualObject = useCallback(
    async (object: VisualObjectRef) => {
      if (activeStoryId == null || !visualClipboard) {
        throw new Error("故事尚未加载，无法复制");
      }
      if (object.type === "owned-video-clip") {
        throw new Error("镜头内部片段不能单独复制，请复制整个镜头");
      }
      const copySequence = ++visualCopySequenceRef.current;
      if (object.type === "story-shot") {
        const clipboardId = createClientOperationId("clipboard");
        const snapshot = await copyStoryVisualObjectCommand({
          editorSessionEpoch,
          clipboardId,
          object,
        });
        if (
          !isEditingStorySessionCurrent() ||
          visualCopySequenceRef.current !== copySequence
        )
          return;
        if (!visualClipboard.write(snapshot)) throw new Error("镜头复制失败");
        storyClipboardIdRef.current = clipboardId;
        setVisualClipboardVersion(version => version + 1);
        toast.success("已复制镜头");
        return;
      }
      const snapshot = snapshotVisualObjectForClipboard({
        storyId: activeStoryId,
        document: canonicalVisualDocument,
        object,
      });
      if (
        !snapshot ||
        snapshot.kind !== "image-clip" ||
        !visualClipboard.write(snapshot)
      ) {
        throw new Error("当前只支持复制独立图片素材");
      }
      storyClipboardIdRef.current = null;
      setVisualClipboardVersion(version => version + 1);
      toast.success(`已复制 ${snapshot.label}`);
    },
    [
      activeStoryId,
      canonicalVisualDocument,
      copyStoryVisualObjectCommand,
      editorSessionEpoch,
      isEditingStorySessionCurrent,
      visualClipboard,
    ]
  );
  const pasteVisualObject = useCallback(
    async (context: { timelineFrame: number; visualLayer?: number }) => {
      if (!visualEditSessionReady)
        throw new Error("剪辑会话仍在初始化，请稍后再试");
      const snapshot = visualClipboard?.read() ?? null;
      if (!snapshot) throw new Error("请先复制一个镜头或图片素材");
      const targetLayer = visualClipboardTargetLayer(
        snapshot,
        context.visualLayer
      );
      const sourceKey =
        snapshot.kind === "image-clip"
          ? snapshot.sourceClipId
          : snapshot.sourceStableShotId;
      const clipboardKey =
        snapshot.kind === "story-shot"
          ? (storyClipboardIdRef.current ?? "expired")
          : "image";
      const intentKey = `${clipboardKey}:${sourceKey}:${context.timelineFrame}:${targetLayer}`;
      const operation =
        visualPasteIntentRef.current.get(intentKey) ?? newVisualOperation();
      visualPasteIntentRef.current.set(intentKey, operation);
      if (snapshot.kind === "story-shot") {
        const clipboardId = storyClipboardIdRef.current;
        if (!clipboardId) throw new Error("镜头剪贴板已失效，请重新复制");
        const stableShotId = await pasteStoryVisualObjectCommand({
          operation,
          clipboardId,
          targetFrame: context.timelineFrame,
          targetLayer,
        });
        if (isEditingStorySessionCurrent()) {
          setActiveSelection({
            sourceType: "shot",
            sourceId: stableShotId,
            selectedText: "已粘贴镜头",
            fullText: "已粘贴镜头",
            storyId: activeStoryId,
            stableShotId,
          });
        }
      } else {
        await pasteVisualImage({
          operation,
          pasteId: operation.operationId,
          snapshot,
          targetFrame: context.timelineFrame,
          targetLayer,
        });
      }
      clearVisualIntentIfCurrent(
        visualPasteIntentRef.current,
        intentKey,
        operation
      );
      if (isEditingStorySessionCurrent()) {
        toast.success(visualPasteSuccessMessage(snapshot.kind));
      }
    },
    [
      isEditingStorySessionCurrent,
      newVisualOperation,
      activeStoryId,
      pasteStoryVisualObjectCommand,
      pasteVisualImage,
      setActiveSelection,
      visualClipboard,
      visualEditSessionReady,
    ]
  );
  const removeVisualObject = useCallback(
    async (object: VisualObjectRef) => {
      const intentKey = visualObjectRefKey(object);
      const operation =
        visualDeleteIntentRef.current.get(intentKey) ?? newVisualOperation();
      visualDeleteIntentRef.current.set(intentKey, operation);
      await deleteVisualObject({ operation, object });
      clearVisualIntentIfCurrent(
        visualDeleteIntentRef.current,
        intentKey,
        operation
      );
      if (isEditingStorySessionCurrent()) toast.success("素材已从时间线删除");
    },
    [deleteVisualObject, isEditingStorySessionCurrent, newVisualOperation]
  );
  const splitOwnedVisualObject = useCallback(
    async (
      object: Extract<VisualObjectRef, { type: "owned-video-clip" }>,
      cutFrame: number
    ) => {
      const intentKey = `${visualObjectRefKey(object)}:${cutFrame}`;
      const operation =
        visualSplitIntentRef.current.get(intentKey) ?? newVisualOperation();
      visualSplitIntentRef.current.set(intentKey, operation);
      await splitOwnedVideoClip({
        operation,
        ownerStableShotId: object.ownerStableShotId,
        clipId: object.clipId,
        cutFrame,
      });
      clearVisualIntentIfCurrent(
        visualSplitIntentRef.current,
        intentKey,
        operation
      );
    },
    [newVisualOperation, splitOwnedVideoClip]
  );
  const imageObjectWinsAt = useCallback(
    (
      object: Extract<VisualObjectRef, { type: "image-clip" }>,
      timelineFrame: number
    ) => {
      const winner = resolveTimelineVisualFrame({
        items: timelineItems,
        overlays: timelineOverlays,
        hiddenVisualLayers: timelineVisualLayerState.hidden,
        frame: timelineFrame,
      });
      return (
        winner.kind === "image" &&
        winner.placement.stableShotId === object.ownerStableShotId &&
        winner.placement.clip.id === object.clipId
      );
    },
    [timelineItems, timelineOverlays, timelineVisualLayerState.hidden]
  );
  const storyObjectWinsAt = useCallback(
    (
      object: Extract<VisualObjectRef, { type: "story-shot" }>,
      timelineFrame: number
    ) => {
      const winner = resolveTimelineVisualFrame({
        items: timelineItems,
        overlays: timelineOverlays,
        hiddenVisualLayers: timelineVisualLayerState.hidden,
        frame: timelineFrame,
      });
      return (
        winner.kind === "shot" &&
        winner.row.item.stableShotId === object.stableShotId
      );
    },
    [timelineItems, timelineOverlays, timelineVisualLayerState.hidden]
  );
  const chatWithVisualObject = useCallback(
    (object: VisualObjectRef, timelineFrame: number) => {
      if (object.type === "story-shot") {
        const shot = shots.find(
          candidate => creationTimelineShotId(candidate) === object.stableShotId
        );
        if (!shot) throw new Error("所选镜头已不存在");
        selectShot(shot.shotNo);
        return;
      }
      const owner = timelineItems.find(
        item => item.stableShotId === object.ownerStableShotId
      );
      const shot = shots.find(
        candidate =>
          creationTimelineShotId(candidate) === object.ownerStableShotId
      );
      if (!owner || !shot) throw new Error("所选素材已不存在");
      if (object.type === "owned-video-clip") {
        const clip = owner.visualClips?.find(item => item.id === object.clipId);
        const row = buildTimelineLayout(timelineItems).find(
          item => item.item.stableShotId === object.ownerStableShotId
        );
        if (!clip || !row) throw new Error("所选视频片段已不存在");
        const startFrame =
          row.startFrame + timelineOffsetMsToFrames(clip.offsetMs);
        const endFrame =
          startFrame + Math.max(1, timelineOffsetMsToFrames(clip.durationMs));
        setSelectedShotNo(shot.shotNo);
        setActiveSelection({
          sourceType: "timeline-range",
          sourceId: object.clipId,
          selectedText: `${clip.label} · 视频片段`,
          fullText: `${clip.label}，时间线 ${timelineFramesToMs(startFrame) / 1000} 到 ${timelineFramesToMs(endFrame) / 1000} 秒`,
          storyId: activeStoryId,
          stableShotId: object.ownerStableShotId,
          shotNo: shot.shotNo,
          cueCode: shot.cueCode ?? null,
          videoTakeId: clip.takeId,
          rangeId: clip.rangeId,
          selection: {
            kind: "time",
            startSec: timelineFramesToMs(startFrame) / 1000,
            endSec: timelineFramesToMs(endFrame) / 1000,
          },
          objectVersion: `timeline-clip:${object.clipId}`,
          materialStatus: "timeline-range",
        });
        return;
      }
      const clip = owner.imageClips?.find(item => item.id === object.clipId);
      if (!clip) throw new Error("所选图片已不存在");
      setSelectedShotNo(shot.shotNo);
      setActiveSelection({
        sourceType: "storyboard-image",
        sourceId: `timeline-image:${object.clipId}`,
        selectedText: `${clip.label} · 时间线图片`,
        fullText: `${clip.label}，位于第 ${timelineFrame} 帧`,
        storyId: activeStoryId,
        stableShotId: object.ownerStableShotId,
        shotNo: shot.shotNo,
        cueCode: shot.cueCode ?? null,
        imageId: clip.imageId,
        objectVersion: `timeline-image:${object.clipId}`,
        materialStatus: "current-image",
      });
    },
    [
      activeStoryId,
      selectShot,
      setActiveSelection,
      setSelectedShotNo,
      shots,
      timelineItems,
    ]
  );

  const isVisualObjectCommandAvailable = useCallback(
    (
      object: VisualObjectRef,
      command: VisualObjectCommand,
      context?: VisualCommandContext
    ) => {
      if (!visualEditSessionReady && command !== "chat") return false;
      if (command === "extract-frame" || command === "chat") return true;
      if (command === "split") return object.type !== "image-clip";
      if (command === "delete") return true;
      if (command === "copy") return object.type !== "owned-video-clip";
      if (command === "set-anchor") {
        if (object.type === "story-shot") {
          return Boolean(
            context && storyObjectWinsAt(object, context.timelineFrame)
          );
        }
        return Boolean(
          object.type === "image-clip" &&
            context &&
            imageObjectWinsAt(object, context.timelineFrame)
        );
      }
      return false;
    },
    [imageObjectWinsAt, storyObjectWinsAt, visualEditSessionReady]
  );

  const executeVisualObjectCommand = useCallback(
    async (
      object: VisualObjectRef,
      command: VisualObjectCommand,
      context: VisualCommandContext
    ) => {
      if (!visualEditSessionReady && command !== "chat") {
        throw new Error("剪辑会话仍在初始化，请稍后再试");
      }
      if (command === "copy") {
        await copyVisualObject(object);
        return;
      }
      if (command === "delete") {
        if (object.type === "story-shot") {
          const intentKey = visualObjectRefKey(object);
          const operation =
            visualDeleteIntentRef.current.get(intentKey) ??
            newVisualOperation();
          visualDeleteIntentRef.current.set(intentKey, operation);
          const selectedStableShotId = await deleteStoryVisualShotCommand({
            operation,
            stableShotId: object.stableShotId,
          });
          clearVisualIntentIfCurrent(
            visualDeleteIntentRef.current,
            intentKey,
            operation
          );
          if (isEditingStorySessionCurrent() && selectedStableShotId) {
            setActiveSelection({
              sourceType: "shot",
              sourceId: selectedStableShotId,
              selectedText: "剩余镜头",
              fullText: "剩余镜头",
              storyId: activeStoryId,
              stableShotId: selectedStableShotId,
            });
          }
          if (isEditingStorySessionCurrent()) toast.success("镜头已删除");
        } else {
          await removeVisualObject(object);
        }
        return;
      }
      if (command === "split") {
        if (object.type === "owned-video-clip") {
          await splitOwnedVisualObject(object, context.timelineFrame);
        } else if (object.type === "story-shot") {
          await splitAtPlayhead(
            timelineFramesToMs(context.timelineFrame),
            object.stableShotId
          );
        } else {
          throw new Error("图片不能切割");
        }
        if (isEditingStorySessionCurrent()) toast.success("已在当前帧切割");
        return;
      }
      if (command === "chat") {
        chatWithVisualObject(object, context.timelineFrame);
        toast.success("已把所选素材交给聊聊");
        return;
      }
      if (command === "set-anchor") {
        if (
          object.type === "image-clip" &&
          !imageObjectWinsAt(object, context.timelineFrame)
        ) {
          throw new Error("所选图片在这一帧不可见，不能设置位置锚点");
        }
        if (
          object.type === "story-shot" &&
          !storyObjectWinsAt(object, context.timelineFrame)
        ) {
          throw new Error("所选镜头在这一帧不可见，不能设置位置锚点");
        }
        const result = await addTimelineAnchorAtFrame(context.timelineFrame);
        if (!result.applied)
          throw new Error(result.reason ?? "设置位置锚点失败");
        if (isEditingStorySessionCurrent()) toast.success("已钉下位置锚点");
        return;
      }
      if (command !== "extract-frame") {
        throw new Error("这个对象命令尚未接入");
      }
      const atMs = timelineFramesToMs(context.timelineFrame);
      seekTimeline(atMs);
      try {
        await extractFrameAtPlayhead(atMs, context.visualLayer);
      } catch (error) {
        if (!isEditingStorySessionCurrent()) return;
        throw error;
      }
      if (isEditingStorySessionCurrent()) {
        toast.success("当前帧已加入相邻上层，并保存在图片仓库");
      }
    },
    [
      activeStoryId,
      addTimelineAnchorAtFrame,
      chatWithVisualObject,
      copyVisualObject,
      deleteStoryVisualShotCommand,
      extractFrameAtPlayhead,
      imageObjectWinsAt,
      isEditingStorySessionCurrent,
      newVisualOperation,
      removeVisualObject,
      seekTimeline,
      setActiveSelection,
      splitAtPlayhead,
      splitOwnedVisualObject,
      storyObjectWinsAt,
      visualEditSessionReady,
    ]
  );

  return {
    editingStorySessionKey,
    isEditingStorySessionCurrent,
    visualClipboard,
    hasVisualClipboard,
    splitAtPlayhead,
    extractFrameAtTimelineFrame,
    extractFrameAtPlayhead,
    copyVisualObject,
    pasteVisualObject,
    removeVisualObject,
    splitOwnedVisualObject,
    imageObjectWinsAt,
    storyObjectWinsAt,
    chatWithVisualObject,
    isVisualObjectCommandAvailable,
    executeVisualObjectCommand,
  };
}
