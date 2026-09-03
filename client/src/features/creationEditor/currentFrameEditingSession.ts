import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { timelineOffsetMsToFrames } from "@shared/storyMaterial";
import type { FrozenTimelineFrame } from "./useTimelinePlaybackClock";

type CurrentFrameVideoSource = {
  visualLayer: number;
};

export type CurrentFrameEditingSessionState<TTarget> =
  | { phase: "idle" }
  | { phase: "extracting"; position: FrozenTimelineFrame }
  | { phase: "ready"; position: FrozenTimelineFrame; target: TTarget }
  | { phase: "error"; position?: FrozenTimelineFrame; message: string };

export async function runCurrentFrameEditingSession<TResult, TTarget>(input: {
  pauseAtCurrentFrame: () => FrozenTimelineFrame;
  resolveVideoSource: (playheadMs: number) => CurrentFrameVideoSource | null;
  extractFrame: (input: {
    timelineFrame: number;
    operationLayer: number;
  }) => Promise<TResult>;
  isSessionCurrent: () => boolean;
  buildTarget: (result: TResult, position: FrozenTimelineFrame) => TTarget;
  seekTimeline: (playheadMs: number) => void;
  openImageEditor: (
    target: TTarget,
    options: { preservePlayhead: true }
  ) => void;
  onExtracting?: (position: FrozenTimelineFrame) => void;
}): Promise<{ position: FrozenTimelineFrame; target: TTarget } | null> {
  const position = input.pauseAtCurrentFrame();
  input.onExtracting?.(position);
  const source = input.resolveVideoSource(position.playheadMs);
  if (!source) throw new Error("当前播放头没有可编辑的视频画面");

  const result = await input.extractFrame({
    timelineFrame: position.timelineFrame,
    operationLayer: source.visualLayer,
  });
  if (!input.isSessionCurrent()) return null;

  const target = input.buildTarget(result, position);
  // 抽帧会刷新时间线数据。无论刷新期间 Preview 怎样重渲染，都重新回到同一
  // 个规范帧，再打开对应图片编辑器，避免一帧图片被下一帧的视频顶掉。
  input.seekTimeline(position.playheadMs);
  input.openImageEditor(target, { preservePlayhead: true });
  return { position, target };
}

/**
 * “调整画面”的唯一流程所有者。它把播放头位置、服务端抽帧结果和图片编辑目标
 * 绑定成同一个会话；故事切换、播放恢复或离开目标帧都会令会话失效。
 */
export function useCurrentFrameEditingSession<TResult, TTarget>(input: {
  sessionKey: string;
  playheadMs: number;
  timelinePlaying: boolean;
  pauseAtCurrentFrame: () => FrozenTimelineFrame;
  resolveVideoSource: (playheadMs: number) => CurrentFrameVideoSource | null;
  extractFrame: (input: {
    timelineFrame: number;
    operationLayer: number;
  }) => Promise<TResult>;
  isStorySessionCurrent: () => boolean;
  buildTarget: (result: TResult, position: FrozenTimelineFrame) => TTarget;
  seekTimeline: (playheadMs: number) => void;
  openImageEditor: (
    target: TTarget,
    options: { preservePlayhead: true }
  ) => void;
}) {
  const {
    sessionKey,
    playheadMs,
    timelinePlaying,
    pauseAtCurrentFrame,
    resolveVideoSource,
    extractFrame,
    isStorySessionCurrent,
    buildTarget,
    seekTimeline,
    openImageEditor,
  } = input;
  const [state, setState] = useState<CurrentFrameEditingSessionState<TTarget>>({
    phase: "idle",
  });
  const requestSequenceRef = useRef(0);

  const reset = useCallback(() => {
    requestSequenceRef.current += 1;
    setState({ phase: "idle" });
  }, []);

  useLayoutEffect(() => {
    reset();
  }, [reset, sessionKey]);

  useEffect(() => {
    if (state.phase !== "ready") return;
    if (
      timelinePlaying ||
      timelineOffsetMsToFrames(playheadMs) !== state.position.timelineFrame
    ) {
      reset();
    }
  }, [playheadMs, reset, state, timelinePlaying]);

  const start = useCallback(async () => {
    const requestId = ++requestSequenceRef.current;
    let frozenPosition: FrozenTimelineFrame | undefined;
    try {
      const outcome = await runCurrentFrameEditingSession({
        pauseAtCurrentFrame,
        resolveVideoSource,
        extractFrame,
        isSessionCurrent: () =>
          requestSequenceRef.current === requestId && isStorySessionCurrent(),
        buildTarget,
        seekTimeline,
        openImageEditor,
        onExtracting: position => {
          frozenPosition = position;
          if (requestSequenceRef.current === requestId) {
            setState({ phase: "extracting", position });
          }
        },
      });
      if (!outcome) return null;
      if (requestSequenceRef.current === requestId) {
        setState({
          phase: "ready",
          position: outcome.position,
          target: outcome.target,
        });
      }
      return outcome.target;
    } catch (error) {
      if (requestSequenceRef.current === requestId) {
        setState({
          phase: "error",
          ...(frozenPosition ? { position: frozenPosition } : {}),
          message: error instanceof Error ? error.message : "当前帧编辑失败",
        });
      }
      throw error;
    }
  }, [
    buildTarget,
    extractFrame,
    isStorySessionCurrent,
    openImageEditor,
    pauseAtCurrentFrame,
    resolveVideoSource,
    seekTimeline,
  ]);

  return { state, start, reset };
}
