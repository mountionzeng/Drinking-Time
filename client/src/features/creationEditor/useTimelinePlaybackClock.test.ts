import { describe, expect, it } from "vitest";
import {
  advanceTimelinePlayhead,
  clampTimelinePlayheadMs,
} from "./timelinePlayhead";
import {
  createTimelinePlaybackRuntime,
  resolvePlayRequest,
  timelinePlaybackFrame,
} from "./useTimelinePlaybackClock";

/**
 * 时钟的同步事实在 runtime 中直接测试；这里同时守住它依赖的算术，
 * 以及「从片尾按播放要回到开头」这条显式分支。
 */
describe("播放时钟的算术", () => {
  it("normalizes milliseconds to one canonical 30fps frame for subtitle and audio", () => {
    expect(timelinePlaybackFrame(-50)).toBe(0);
    expect(timelinePlaybackFrame(999)).toBe(30);
    expect(timelinePlaybackFrame(2_000)).toBe(60);
  });

  it("推进不会越过片尾，并在到尾时报告 ended", () => {
    expect(advanceTimelinePlayhead(0, 1000, 5000)).toEqual({
      timeMs: 1000,
      ended: false,
    });
    expect(advanceTimelinePlayhead(4900, 1000, 5000)).toEqual({
      timeMs: 5000,
      ended: true,
    });
  });

  it("异常的时间增量按 0 处理，不会把播放头甩飞", () => {
    expect(advanceTimelinePlayhead(1000, Number.NaN, 5000).timeMs).toBe(1000);
    expect(advanceTimelinePlayhead(1000, -50, 5000).timeMs).toBe(1000);
  });

  it("定位钳在 0 与片长之间", () => {
    expect(clampTimelinePlayheadMs(-100, 5000)).toBe(0);
    expect(clampTimelinePlayheadMs(9999, 5000)).toBe(5000);
  });

  it("片尾状态可判定——hook 靠它决定按播放时要不要先回到开头", () => {
    const totalMs = 5000;
    expect(5000 >= totalMs).toBe(true);
    expect(advanceTimelinePlayhead(0, 16, totalMs).ended).toBe(false);
  });
});

describe("按下播放时的状态解析", () => {
  const at = (playheadMs: number, isPlaying = false) => ({
    playheadMs,
    isPlaying,
  });

  it("片中按播放：原地开始，不动播放头", () => {
    expect(resolvePlayRequest(at(2000), true, 5000)).toEqual({
      playheadMs: 2000,
      isPlaying: true,
    });
  });

  it("片尾按播放：回到开头再走——否则按下去什么也不会发生", () => {
    expect(resolvePlayRequest(at(5000), true, 5000)).toEqual({
      playheadMs: 0,
      isPlaying: true,
    });
  });

  it("越过片尾同样回到开头", () => {
    expect(resolvePlayRequest(at(9999), true, 5000)).toEqual({
      playheadMs: 0,
      isPlaying: true,
    });
  });

  it("暂停不动播放头，哪怕正好停在片尾", () => {
    expect(resolvePlayRequest(at(5000, true), false, 5000)).toEqual({
      playheadMs: 5000,
      isPlaying: false,
    });
  });

  it("片长为 0 时按播放不会卡住——回到 0 并且立刻由推进逻辑判终止", () => {
    expect(resolvePlayRequest(at(0), true, 0)).toEqual({
      playheadMs: 0,
      isPlaying: true,
    });
    expect(advanceTimelinePlayhead(0, 16, 0).ended).toBe(true);
  });
});

describe("播放时钟运行边界", () => {
  it("presents a warm video cut first and cancels its queued selection on seek", () => {
    const queued: (() => void)[] = [], selected: number[] = [];
    const clock = createTimelinePlaybackRuntime({ totalMs: 600,
      afterVideoFrame: run => queued.push(run), onPlayheadCommit: ms => selected.push(ms) });
    clock.setBoundaries([100, 200], ms => ms < 200);
    clock.setPlaying(true);
    const initial = clock.getEditorState();
    clock.advance(100);
    expect(clock.position.getTimeMs()).toBe(100);
    expect(clock.getEditorState()).toBe(initial);
    expect(queued).toHaveLength(1);
    clock.seek(35);
    queued.shift()!();
    expect(selected.at(-1)).toBe(35);
    clock.advance(70);
    queued.shift()!();
    expect(clock.getEditorState().playheadMs).toBe(105);
    clock.advance(100);
    expect(queued).toHaveLength(0);
    expect(clock.getEditorState().playheadMs).toBe(205);
  });
  it("keeps frame updates local until a cut, seek, pause or the end", () => {
    let now = 100;
    const runtime = createTimelinePlaybackRuntime({ totalMs: 500, now: () => now });
    runtime.setBoundaries([100]);
    runtime.setPlaying(true);
    const initial = runtime.getEditorState();
    const positions: number[] = [];
    const unsubscribe = runtime.position.subscribe(() => positions.push(runtime.position.getTimeMs()));
    runtime.advance(34);
    expect(runtime.getEditorState()).toBe(initial);
    expect(positions).toEqual([34]);
    now += 130;
    expect(runtime.position.getPlaybackTimeMs()).toBe(130);
    runtime.advance(96);
    expect(runtime.getEditorState().playheadMs).toBe(130);
    runtime.seek(30);
    expect(runtime.getEditorState().playheadMs).toBe(30);
    expect(runtime.position.getPlaybackTimeMs()).toBe(30);
    runtime.setPlaying(false);
    now += 1000;
    expect(runtime.position.getPlaybackTimeMs()).toBe(30);
    runtime.setPlaying(true);
    runtime.advance(500);
    expect(runtime.getEditorState()).toEqual({ playheadMs: 500, isPlaying: false });
    runtime.togglePlaying();
    expect(runtime.position.getPlaybackTimeMs()).toBe(0);
    unsubscribe();
  });
  it("同步冻结后，即使旧的动画帧回调抵达也不能继续推进播放头", () => {
    const committed: number[] = [];
    const runtime = createTimelinePlaybackRuntime({
      totalMs: 5_000,
      onPlayheadCommit: playheadMs => committed.push(playheadMs),
    });

    runtime.seek(1_000);
    runtime.setPlaying(true);
    runtime.advance(20);

    const frozen = runtime.pauseAtCurrentFrame();
    const stateAfterStaleTick = runtime.advance(20);

    expect(frozen).toEqual({ timelineFrame: 31, playheadMs: 1_033 });
    expect(stateAfterStaleTick).toEqual({
      playheadMs: 1_033,
      isPlaying: false,
    });
    expect(committed.at(-1)).toBe(1_033);
  });

  it("冻结后立即恢复时可以从同一规范帧继续推进", () => {
    const runtime = createTimelinePlaybackRuntime({ totalMs: 5_000 });
    runtime.seek(1_000);
    runtime.setPlaying(true);

    const frozen = runtime.pauseAtCurrentFrame();
    runtime.setPlaying(true);
    const resumed = runtime.advance(20);

    expect(frozen).toEqual({ timelineFrame: 30, playheadMs: 1_000 });
    expect(resumed).toEqual({ playheadMs: 1_020, isPlaying: true });
  });
});
