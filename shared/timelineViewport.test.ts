import { describe, expect, it } from "vitest";
import {
  clampTimelineScale,
  createTimelineViewport,
  formatTimelineTimecode,
  frameToPx,
  frameDeltaToPx,
  framePx,
  msToPx,
  pxToFrame,
  pxToMs,
  pxDeltaToFrame,
  pxDeltaToMs,
  tickSeconds,
  tickStepSec,
  DEFAULT_TIMELINE_SCALE,
  MAX_TIMELINE_SCALE,
  MIN_TIMELINE_SCALE,
} from "./timelineViewport";

const viewport = (totalMs: number, scale = 16) =>
  createTimelineViewport({ totalMs, scale });

describe("时间线视口", () => {
  it("内容宽度按每秒像素数算，而不是跟着容器走", () => {
    // 这正是百分比坐标做不到的：同一份故事，缩放变了宽度就该变。
    expect(viewport(60_000, 16).contentWidth).toBe(960);
    expect(viewport(60_000, 32).contentWidth).toBe(1920);
  });

  it("再短的故事也不塌成一条线", () => {
    expect(viewport(0).contentWidth).toBe(720);
    expect(viewport(1_000).contentWidth).toBe(720);
  });

  it("时间和像素可以来回换算，不丢位置", () => {
    const v = viewport(120_000, 20);
    for (const ms of [0, 1_000, 33_333, 119_999]) {
      expect(Math.round(pxToMs(v, msToPx(v, ms)))).toBe(Math.round(ms));
    }
  });

  it("帧同样能来回换算", () => {
    const v = viewport(120_000, 20);
    for (const frame of [0, 1, 71, 480, 1479]) {
      expect(pxToFrame(v, frameToPx(v, frame))).toBe(frame);
    }
  });

  it("像素位移保留方向，且同样 100px 在放大后移动更少帧", () => {
    expect(pxDeltaToMs(viewport(60_000, 20), -100)).toBe(-5_000);
    expect(pxDeltaToFrame(viewport(60_000, 16), 100)).toBe(188);
    expect(pxDeltaToFrame(viewport(60_000, 32), 100)).toBe(94);
    expect(frameDeltaToPx(viewport(60_000, 32), -30)).toBe(-32);
  });

  it("一帧的宽度随缩放变化——这就是「一帧图片点不中」有没有救的判据", () => {
    // 16px/秒 时一帧只有 0.53px，点不中；放大到 42 就有 1.4px，
    // 再加上交互命中宽度才谈得上可操作。
    expect(framePx(viewport(60_000, 16))).toBeCloseTo(16 / 30, 5);
    expect(framePx(viewport(60_000, 42))).toBeCloseTo(42 / 30, 5);
  });

  it("缩放钳在边界内，脏数据回落到默认值", () => {
    expect(clampTimelineScale(1)).toBe(MIN_TIMELINE_SCALE);
    expect(clampTimelineScale(999)).toBe(MAX_TIMELINE_SCALE);
    expect(clampTimelineScale(Number.NaN)).toBe(DEFAULT_TIMELINE_SCALE);
  });

  it("放大时刻度标得密，缩小时标得疏，文字不会叠在一起", () => {
    expect(tickStepSec(viewport(60_000, 40))).toBe(2);
    expect(tickStepSec(viewport(60_000, 24))).toBe(5);
    expect(tickStepSec(viewport(60_000, 16))).toBe(10);
    expect(tickStepSec(viewport(60_000, 8))).toBe(30);
  });

  it("刻度覆盖到片尾，不会少最后一格", () => {
    const ticks = tickSeconds(viewport(65_000, 16));
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(65);
  });

  it("时间码超过一小时会显示小时位", () => {
    expect(formatTimelineTimecode(0)).toBe("00:00");
    expect(formatTimelineTimecode(69_170)).toBe("01:09");
    expect(formatTimelineTimecode(3_600_000)).toBe("01:00:00");
    expect(formatTimelineTimecode(-5)).toBe("00:00");
  });
});
