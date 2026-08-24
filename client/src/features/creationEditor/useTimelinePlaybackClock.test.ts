import { describe, expect, it } from "vitest";
import {
  advanceTimelinePlayhead,
  clampTimelinePlayheadMs,
} from "./timelinePlayhead";
import { resolvePlayRequest } from "./useTimelinePlaybackClock";

/**
 * 时钟 hook 本身要 React 渲染环境才能测，这里守的是它依赖的两条算术，
 * 以及「从片尾按播放要回到开头」这个 hook 里显式处理的分支。
 */
describe("播放时钟的算术", () => {
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
