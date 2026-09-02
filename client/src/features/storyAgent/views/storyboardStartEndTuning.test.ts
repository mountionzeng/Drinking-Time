/**
 * 2026-08-19：首尾帧的时长和运动幅度以前只能被推导——`durationSec` 跟着镜头时长
 * （0307 的 4433ms 只能得到 4 秒），`movementAmplitude` 从 `motion` 落下来，产品里
 * 没有入口，想跑 8 秒或加大幅度只能改脚本。这组用例锁住故事版写进 generationParams
 * 的值能被 `parseStartEndVideoConfig` 原样读出来。
 */
import { describe, expect, it } from "vitest";
import { parseStartEndVideoConfig } from "@shared/startEndVideo";
import {
  clampStoryboardStartEndDurationSec,
  storyboardStartEndAmplitude,
  storyboardStartEndDurationSec,
  storyboardStartEndTuningGenerationParams,
} from "./storyboardReviewModel";

const startEndParams = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    frameMode: "start_end",
    firstFrameImageId: 1613,
    lastFrameImageId: 1614,
    resolution: "1080p",
    ...extra,
  });

describe("首尾帧时长与运动幅度", () => {
  it("没配过时长时按镜头时长回落，配过就用配置值", () => {
    expect(storyboardStartEndDurationSec(startEndParams(), 4_433)).toBe(4);
    expect(
      storyboardStartEndDurationSec(startEndParams({ durationSec: 8 }), 4_433)
    ).toBe(8);
  });

  it("时长夹在 Vidu Q2 的 1–8 秒内，不把非法值送到付费提交", () => {
    expect(clampStoryboardStartEndDurationSec(16)).toBe(8);
    expect(clampStoryboardStartEndDurationSec(0)).toBe(4);
    expect(clampStoryboardStartEndDurationSec("abc")).toBe(4);
    expect(
      storyboardStartEndDurationSec(startEndParams({ durationSec: 16 }), 4_433)
    ).toBe(8);
  });

  it("没配过幅度时沿用 motion 的旧口径", () => {
    expect(storyboardStartEndAmplitude(startEndParams({ motion: "high" }))).toBe(
      "large"
    );
    expect(storyboardStartEndAmplitude(startEndParams({ motion: "low" }))).toBe(
      "small"
    );
    expect(storyboardStartEndAmplitude(startEndParams())).toBe("auto");
  });

  it("写进去的 8 秒 + 大幅度能被 parseStartEndVideoConfig 原样读出来", () => {
    const next = storyboardStartEndTuningGenerationParams(startEndParams(), {
      durationSec: 8,
      movementAmplitude: "large",
    });

    const config = parseStartEndVideoConfig(next, 4.433);

    expect(config).toMatchObject({
      frameMode: "start_end",
      durationSec: 8,
      movementAmplitude: "large",
      resolution: "1080p",
      model: "viduq2-turbo",
    });
  });

  /**
   * `parseStartEndVideoConfig` 里有一条：configuredAmplitude 是 "auto" 且 motion
   * 有值时，忽略显式配置改用 motion。所以显式选幅度必须同时清掉 motion，
   * 否则用户选的「自动」会被旧的 motion 悄悄改写成大/小。
   */
  it("显式选幅度会清掉 motion，避免旧字段覆盖用户选择", () => {
    const next = storyboardStartEndTuningGenerationParams(
      startEndParams({ motion: "high" }),
      { movementAmplitude: "auto" }
    );

    expect(JSON.parse(next)).not.toHaveProperty("motion");
    expect(parseStartEndVideoConfig(next, 4.433)?.movementAmplitude).toBe(
      "auto"
    );
  });

  it("只改一个字段时不动另一个", () => {
    const withDuration = storyboardStartEndTuningGenerationParams(
      startEndParams({ movementAmplitude: "large" }),
      { durationSec: 6 }
    );

    expect(parseStartEndVideoConfig(withDuration, 4.433)).toMatchObject({
      durationSec: 6,
      movementAmplitude: "large",
    });
  });

  it("保留 generationParams 里既有的首尾帧配置，不覆盖其它键", () => {
    const next = storyboardStartEndTuningGenerationParams(
      startEndParams({ characterContinuity: { source: "anchor" } }),
      { durationSec: 8 }
    );

    const parsed = JSON.parse(next);
    expect(parsed.firstFrameImageId).toBe(1613);
    expect(parsed.lastFrameImageId).toBe(1614);
    expect(parsed.characterContinuity).toEqual({ source: "anchor" });
  });
});
