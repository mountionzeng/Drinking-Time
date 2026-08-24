import { useCallback, useEffect, useRef, useState } from "react";
import {
  advanceTimelinePlayhead,
  clampTimelinePlayheadMs,
} from "./timelinePlayhead";

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

export function useTimelinePlaybackClock(input: {
  totalMs: number;
  /** 播放头跨进新镜头时通知外部（用来同步选中态）。 */
  onPlayheadCommit?: (playheadMs: number) => void;
}) {
  const { totalMs, onPlayheadCommit } = input;
  const [state, setState] = useState<TimelinePlaybackClockState>({
    playheadMs: 0,
    isPlaying: false,
  });

  // 循环内部要读最新值，但不能因为它变化就重建循环。
  const playheadRef = useRef(0);
  const totalRef = useRef(totalMs);
  const commitRef = useRef(onPlayheadCommit);
  useEffect(() => {
    totalRef.current = totalMs;
  }, [totalMs]);
  useEffect(() => {
    commitRef.current = onPlayheadCommit;
  }, [onPlayheadCommit]);

  const seek = useCallback((requestedMs: number) => {
    const next = clampTimelinePlayheadMs(requestedMs, totalRef.current);
    playheadRef.current = next;
    setState(current => ({ ...current, playheadMs: next }));
    commitRef.current?.(next);
  }, []);

  const setPlaying = useCallback((isPlaying: boolean) => {
    setState(current => {
      const next = resolvePlayRequest(current, isPlaying, totalRef.current);
      playheadRef.current = next.playheadMs;
      return next;
    });
  }, []);

  const togglePlaying = useCallback(
    () => setState(current => ({ ...current, isPlaying: !current.isPlaying })),
    []
  );

  // 循环只依赖 isPlaying：时长和回调都走 ref，避免每次变化都重建循环。
  useEffect(() => {
    if (!state.isPlaying) return;
    let frame = 0;
    let previous = performance.now();
    let cancelled = false;

    const tick = (now: number) => {
      if (cancelled) return;
      const next = advanceTimelinePlayhead(
        playheadRef.current,
        now - previous,
        totalRef.current
      );
      previous = now;
      playheadRef.current = next.timeMs;

      // 先预约下一帧，再提交状态——顺序见文件头注释。
      if (!next.ended) frame = requestAnimationFrame(tick);
      setState(current => ({
        playheadMs: next.timeMs,
        isPlaying: next.ended ? false : current.isPlaying,
      }));
      commitRef.current?.(next.timeMs);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [state.isPlaying]);

  return {
    playheadMs: state.playheadMs,
    isPlaying: state.isPlaying,
    seek,
    setPlaying,
    togglePlaying,
  };
}
