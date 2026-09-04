import { useCallback, useEffect, useRef, useState } from "react";
import {
  advanceTimelinePlayhead,
  clampTimelinePlayheadMs,
} from "./timelinePlayhead";
import {
  timelineFramesToMs,
  timelineOffsetMsToFrames,
} from "@shared/storyMaterial";

/**
 * 时间线的播放时钟。
 *
 * 以前它长在底部时间线组件（MultiTrackTimeline）内部，于是有两个后果：
 *
 * 1. 故事版的播放键只能把请求「转发」给底部时间线，中间隔着 playbackRequest
 *    这层 id 递增的握手。2026-08-24 实测这条链路是断的：按下播放后按钮翻成
 *    暂停、状态也确实是 playing，但播放头一帧都不动。
 * 2. 底部时间线一旦删掉，播放就整个没了——时钟不该住在一个要被删的界面里。
 *
 * 所以时钟提到父层：谁需要播放，谁读这份状态；界面只是它的投影。
 *
 * rAF 循环里有一处顺序是刻意的：**先预约下一帧，再提交状态**。反过来的话，
 * 提交状态可能触发 effect 清理，旧循环会在清理之后又偷偷预约一帧，每次切
 * 镜头都多出一条 rAF，表现为时间线加速和画面闪烁。这是既有代码踩过的坑，
 * 搬过来时原样保留。
 */

export type TimelinePlaybackClockState = {
  playheadMs: number;
  isPlaying: boolean;
};

export type FrozenTimelineFrame = {
  timelineFrame: number;
  playheadMs: number;
};

/** One frame normalization shared by Preview subtitles and the audio engine. */
export function timelinePlaybackFrame(playheadMs: number): number {
  return timelineOffsetMsToFrames(Math.max(0, playheadMs));
}

/**
 * 按下播放/暂停之后，时钟该处于什么状态。
 *
 * 单独抽出来是因为它是这个 hook 里唯一一条不平凡的规则：**播放头已经在片尾
 * 时按播放，要从头开始**。不这么处理的话按钮按下去什么也不会发生，用户只会
 * 觉得播放键坏了。其余部分都是 rAF 胶水，逻辑在 advanceTimelinePlayhead 里。
 */
export function resolvePlayRequest(
  current: TimelinePlaybackClockState,
  isPlaying: boolean,
  totalMs: number
): TimelinePlaybackClockState {
  if (isPlaying && current.playheadMs >= Math.max(0, totalMs)) {
    return { playheadMs: 0, isPlaying: true };
  }
  return { ...current, isPlaying };
}

/**
 * 播放状态的同步事实层。React 只负责把这份状态投影到界面；暂停、定位和旧 rAF
 * 回调是否还能推进播放头，都先在这里裁决。这样用户发起“编辑当前帧”时，不必
 * 等下一次 React 提交才能真正停住时钟。
 */
export function createTimelinePlaybackRuntime(input: {
  totalMs: number;
  onPlayheadCommit?: (playheadMs: number) => void;
}) {
  const normalizeTotalMs = (value: number) =>
    Number.isFinite(value) ? Math.max(0, value) : 0;
  let totalMs = normalizeTotalMs(input.totalMs);
  let onPlayheadCommit = input.onPlayheadCommit;
  let state: TimelinePlaybackClockState = {
    playheadMs: 0,
    isPlaying: false,
  };

  const commit = (next: TimelinePlaybackClockState) => {
    state = next;
    return state;
  };

  return {
    getState: () => state,
    setTotalMs: (nextTotalMs: number) => {
      totalMs = normalizeTotalMs(nextTotalMs);
    },
    setOnPlayheadCommit: (
      nextOnPlayheadCommit?: (playheadMs: number) => void
    ) => {
      onPlayheadCommit = nextOnPlayheadCommit;
    },
    seek: (requestedMs: number) => {
      const playheadMs = clampTimelinePlayheadMs(requestedMs, totalMs);
      const next = commit({ ...state, playheadMs });
      onPlayheadCommit?.(playheadMs);
      return next;
    },
    setPlaying: (isPlaying: boolean) =>
      commit(resolvePlayRequest(state, isPlaying, totalMs)),
    togglePlaying: () =>
      commit(resolvePlayRequest(state, !state.isPlaying, totalMs)),
    advance: (deltaMs: number) => {
      if (!state.isPlaying) return state;
      const nextPlayhead = advanceTimelinePlayhead(
        state.playheadMs,
        deltaMs,
        totalMs
      );
      const next = commit({
        playheadMs: nextPlayhead.timeMs,
        isPlaying: !nextPlayhead.ended,
      });
      onPlayheadCommit?.(next.playheadMs);
      return next;
    },
    pauseAtCurrentFrame: (): FrozenTimelineFrame => {
      const currentMs = clampTimelinePlayheadMs(state.playheadMs, totalMs);
      const timelineFrame = timelineOffsetMsToFrames(currentMs);
      const playheadMs = clampTimelinePlayheadMs(
        timelineFramesToMs(timelineFrame),
        totalMs
      );
      commit({ playheadMs, isPlaying: false });
      onPlayheadCommit?.(playheadMs);
      return { timelineFrame, playheadMs };
    },
  };
}

export function useTimelinePlaybackClock(input: {
  totalMs: number;
  /** 播放头跨进新镜头时通知外部（用来同步选中态）。 */
  onPlayheadCommit?: (playheadMs: number) => void;
}) {
  const { totalMs, onPlayheadCommit } = input;
  const runtimeRef = useRef<ReturnType<
    typeof createTimelinePlaybackRuntime
  > | null>(null);
  if (!runtimeRef.current) {
    runtimeRef.current = createTimelinePlaybackRuntime({
      totalMs,
      onPlayheadCommit,
    });
  }
  const runtime = runtimeRef.current;
  runtime.setTotalMs(totalMs);
  runtime.setOnPlayheadCommit(onPlayheadCommit);
  const [state, setState] = useState<TimelinePlaybackClockState>(() =>
    runtime.getState()
  );
  const [playbackRunId, setPlaybackRunId] = useState(0);
  const scheduledFrameRef = useRef<number | null>(null);

  const seek = useCallback(
    (requestedMs: number) => {
      setState(runtime.seek(requestedMs));
    },
    [runtime]
  );

  const setPlaying = useCallback(
    (isPlaying: boolean) => {
      const next = runtime.setPlaying(isPlaying);
      if (!next.isPlaying && scheduledFrameRef.current != null) {
        cancelAnimationFrame(scheduledFrameRef.current);
        scheduledFrameRef.current = null;
      } else if (next.isPlaying && scheduledFrameRef.current == null) {
        // 暂停和恢复可能被 React 合成一次提交，最终 isPlaying 仍为 true。
        // 单独递增运行轮次，确保已取消的 rAF 一定会重新建立。
        setPlaybackRunId(current => current + 1);
      }
      setState(next);
    },
    [runtime]
  );

  const togglePlaying = useCallback(() => {
    const next = runtime.togglePlaying();
    if (!next.isPlaying && scheduledFrameRef.current != null) {
      cancelAnimationFrame(scheduledFrameRef.current);
      scheduledFrameRef.current = null;
    } else if (next.isPlaying && scheduledFrameRef.current == null) {
      setPlaybackRunId(current => current + 1);
    }
    setState(next);
  }, [runtime]);

  const pauseAtCurrentFrame = useCallback(() => {
    if (scheduledFrameRef.current != null) {
      cancelAnimationFrame(scheduledFrameRef.current);
      scheduledFrameRef.current = null;
    }
    const position = runtime.pauseAtCurrentFrame();
    setState(runtime.getState());
    return position;
  }, [runtime]);

  // 时长和回调都走 runtime，避免它们变化时重建循环。playbackRunId 处理
  // “一次 React 提交内先暂停再恢复”的情况，此时 isPlaying 本身不会变化。
  useEffect(() => {
    if (!state.isPlaying) return;
    let previous = performance.now();
    let cancelled = false;

    const tick = (now: number) => {
      if (cancelled) return;
      const wasPlaying = runtime.getState().isPlaying;
      const next = runtime.advance(now - previous);
      if (!wasPlaying) return;
      previous = now;

      // 先预约下一帧，再提交状态——顺序见文件头注释。
      if (next.isPlaying) {
        scheduledFrameRef.current = requestAnimationFrame(tick);
      } else {
        scheduledFrameRef.current = null;
      }
      setState(next);
    };

    scheduledFrameRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (scheduledFrameRef.current != null) {
        cancelAnimationFrame(scheduledFrameRef.current);
        scheduledFrameRef.current = null;
      }
    };
  }, [playbackRunId, runtime, state.isPlaying]);

  return {
    playheadMs: state.playheadMs,
    playheadFrame: timelinePlaybackFrame(state.playheadMs),
    isPlaying: state.isPlaying,
    seek,
    setPlaying,
    togglePlaying,
    pauseAtCurrentFrame,
  };
}
