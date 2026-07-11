import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  createVideoTake: vi.fn(),
  findVideoTakeByIdempotencyKey: vi.fn(),
  getStoryById: vi.fn(),
  getStoryVideoTimelineSelections: vi.fn(),
  getVideoTakeById: vi.fn(),
  setVideoTimelineSelection: vi.fn(),
  updateVideoTake: vi.fn(),
}));

vi.mock("../db", () => dbMocks);

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  childProcessMocks.spawn.mockImplementation((command: string) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: InstanceType<typeof PassThrough>;
      stderr: InstanceType<typeof PassThrough>;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();
    queueMicrotask(() => {
      if (command === "ffprobe") {
        child.stdout.write(
          JSON.stringify({
            streams: [{ width: 1920, height: 1080, duration: 5 }],
            format: { duration: 5 },
          })
        );
      }
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0);
    });
    return child;
  });
  return { spawn: childProcessMocks.spawn };
});

const videoMediaMocks = vi.hoisted(() => ({
  localVideoDir: vi.fn(),
  materializeVideoUrl: vi.fn(),
}));

vi.mock("./videoMedia", () => videoMediaMocks);

vi.mock("../_core/env", () => ({
  ENV: {
    api302Key: "test-only-key",
    api302BaseUrl: "https://api.invalid.test",
  },
}));

import {
  aspectRatioFromDimensions,
  buildVideoConformFilter,
  conformVideoTake,
  canReuseVideoConformTake,
  parseRunwayExpandRefresh,
  parseRunwayExpandSubmission,
  parseRunwayProviderResponseBody,
  runwayExpandInputError,
  runwayExpandProviderAspectRatio,
  runwayExpandRefreshFailureStatus,
  runwayExpandRequestFields,
  runwayExpandSubmissionStateForHttpStatus,
  runwayPaidResultFailurePatch,
  shouldBlockVideoConformRetry,
  videoFileName,
} from "./videoConform";

describe("videoConform", () => {
  it("normalizes common source dimensions to editor aspect ratios", () => {
    expect(aspectRatioFromDimensions(1080, 1080)).toBe("1:1");
    expect(aspectRatioFromDimensions(1920, 1080)).toBe("16:9");
    expect(aspectRatioFromDimensions(1080, 1920)).toBe("9:16");
    expect(aspectRatioFromDimensions(1440, 1080)).toBe("4:3");
  });

  it("builds exact square crop and blur-pad filters", () => {
    const crop = buildVideoConformFilter("crop", "1:1");
    const blurPad = buildVideoConformFilter("blur_pad", "1:1");

    expect(crop).toContain("scale=1080:1080");
    expect(crop).toContain("crop=1080:1080");
    expect(blurPad).toContain("gblur=sigma=28");
    expect(blurPad).toContain("force_original_aspect_ratio=decrease");
  });

  it("moves a square crop from the middle at frame one to the bottom at the final frame", () => {
    const crop = buildVideoConformFilter("crop", "1:1", {
      cropPath: { start: "center", end: "end" },
      durationSec: 4,
    });

    expect(crop).toContain("0.5+(0.5)*t/4");
    expect(crop).toContain("x='(iw-ow)*");
    expect(crop).toContain("y='(ih-oh)*");
  });

  it("parses Runway submission and completion payloads", () => {
    expect(
      parseRunwayExpandSubmission({
        task: { id: "runway_123", status: "THROTTLED", artifacts: [] },
      })
    ).toEqual({ status: "ok", taskId: "runway_123" });

    expect(
      parseRunwayExpandRefresh(
        {
          task: {
            id: "runway_123",
            status: "SUCCEEDED",
            artifacts: [{ url: "https://example.com/output.mp4" }],
          },
        },
        "runway_123"
      )
    ).toEqual({
      status: "available",
      taskId: "runway_123",
      videoUrl: "https://example.com/output.mp4",
    });
  });

  it("preserves the actionable 302 error instead of collapsing it to HTTP 400", () => {
    expect(
      parseRunwayExpandSubmission({
        error: {
          err_code: -10013,
          message: "Model disabled",
          message_cn: "当前 API Key 没有启用 Runway Expand",
        },
      })
    ).toEqual({
      status: "error",
      message: "当前 API Key 没有启用 Runway Expand（302 错误 -10013）",
    });

    expect(
      parseRunwayExpandSubmission({ detail: "video duration is invalid" })
    ).toEqual({ status: "error", message: "video duration is invalid" });
  });

  it("keeps non-JSON provider response text available for diagnosis", () => {
    expect(
      parseRunwayProviderResponseBody(
        "<html><body>upstream rejected the video container</body></html>"
      )
    ).toBe("upstream rejected the video container");
  });

  it("keeps queued jobs processing and exposes provider failures", () => {
    expect(
      parseRunwayExpandRefresh(
        { task: { status: "RUNNING", artifacts: [] } },
        "runway_queued"
      )
    ).toEqual({ status: "processing", taskId: "runway_queued" });

    expect(
      parseRunwayExpandRefresh(
        { task: { status: "FAILED", message: "input rejected" } },
        "runway_failed"
      )
    ).toEqual({
      status: "failed",
      taskId: "runway_failed",
      message: "input rejected",
    });
  });

  it("maps editor ratios to the only ratios accepted by 302 Runway Expand", () => {
    expect(runwayExpandProviderAspectRatio("16:9", "1:1")).toBe("3:5");
    expect(runwayExpandProviderAspectRatio("9:16", "1:1")).toBe("5:3");
    expect(runwayExpandProviderAspectRatio("1:1", "16:9")).toBe("5:3");
    expect(runwayExpandProviderAspectRatio("1:1", "9:16")).toBe("3:5");
  });

  it("writes only provider ratios into the paid multipart request fields", () => {
    expect(
      runwayExpandRequestFields({
        providerAspectRatio: "5:3",
        durationSec: 6,
        prompt: "preserve camera movement",
      })
    ).toEqual({
      text_prompt: "preserve camera movement",
      seconds: "10",
      outpaint_aspect_ratio: "5:3",
    });
  });

  it("locks retries when the paid submission outcome is ambiguous", () => {
    expect(runwayExpandSubmissionStateForHttpStatus(400)).toBe("not_submitted");
    expect(runwayExpandSubmissionStateForHttpStatus(408)).toBe("unknown");
    expect(runwayExpandSubmissionStateForHttpStatus(429)).toBe("unknown");
    expect(runwayExpandSubmissionStateForHttpStatus(502)).toBe("unknown");
    expect(runwayExpandRefreshFailureStatus(400)).toBe("timeout");
    expect(runwayExpandRefreshFailureStatus(401)).toBe("timeout");
    expect(runwayExpandRefreshFailureStatus(404)).toBe("timeout");
    expect(runwayExpandRefreshFailureStatus(408)).toBe("timeout");
    expect(runwayExpandRefreshFailureStatus(429)).toBe("timeout");
    expect(runwayExpandRefreshFailureStatus(503)).toBe("timeout");
    expect(runwayPaidResultFailurePatch("本地下载失败")).toMatchObject({
      status: "timeout",
      errorMessage: expect.stringContaining("锁定自动重试"),
    });
  });

  it("rejects same-orientation legacy expansion before a paid request", () => {
    expect(() => runwayExpandProviderAspectRatio("4:3", "16:9")).toThrow(
      "横竖屏互转"
    );
    expect(() => runwayExpandProviderAspectRatio("3:4", "9:16")).toThrow(
      "横竖屏互转"
    );
  });

  it("validates Runway minimum dimensions and maximum duration before submit", () => {
    expect(
      runwayExpandInputError({ width: 619, height: 1080, durationSec: 5 })
    ).toContain("620×620");
    expect(
      runwayExpandInputError({ width: 1080, height: 1080, durationSec: 10.1 })
    ).toContain("10 秒");
    expect(
      runwayExpandInputError({ width: 1080, height: 1080, durationSec: null })
    ).toContain("无法确认");
    expect(
      runwayExpandInputError({ width: 1080, height: 1080, durationSec: 10 })
    ).toBeNull();
  });

  it("only reuses submitted, processing, or available conform takes", () => {
    expect(canReuseVideoConformTake({ status: "submitted" })).toBe(true);
    expect(canReuseVideoConformTake({ status: "processing" })).toBe(true);
    expect(canReuseVideoConformTake({ status: "available" })).toBe(true);
    expect(canReuseVideoConformTake({ status: "failed" })).toBe(false);
    expect(canReuseVideoConformTake({ status: "timeout" })).toBe(false);
    expect(canReuseVideoConformTake({ status: "unfollowable" })).toBe(false);
    expect(shouldBlockVideoConformRetry({ status: "timeout" })).toBe(true);
    expect(shouldBlockVideoConformRetry({ status: "unfollowable" })).toBe(true);
    expect(shouldBlockVideoConformRetry({ status: "failed" })).toBe(false);
  });
});

describe("videoFileName", () => {
  it("接受自己 id 命名的文件，也接受复用副本指向的源文件", () => {
    expect(videoFileName({ id: 46, videoKey: "take-46.mp4" })).toBe(
      "take-46.mp4"
    );
    // 素材仓库复用：副本 take 1226 指向源 take 46 的文件——不能被拒
    expect(videoFileName({ id: 1226, videoKey: "take-46.mp4" })).toBe(
      "take-46.mp4"
    );
    expect(videoFileName({ id: 1, videoKey: "clip_01.webm" })).toBe(
      "clip_01.webm"
    );
  });

  it("拒绝路径穿越和非视频扩展名", () => {
    // basename 先剥目录，剩余文件名再过白名单
    expect(videoFileName({ id: 1, videoKey: "../../etc/passwd" })).toBeNull();
    expect(videoFileName({ id: 1, videoKey: "take-1.sh" })).toBeNull();
    expect(videoFileName({ id: 1, videoKey: null })).toBeNull();
    expect(videoFileName({ id: 1, videoKey: "a b.mp4" })).toBeNull();
  });
});

describe("conformVideoTake 归属守卫（跨故事复用契约）", () => {
  const testVideoDir = path.join(
    os.tmpdir(),
    `drinking-time-video-conform-${process.pid}`
  );

  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getStoryById.mockResolvedValue({ id: 100 });
    videoMediaMocks.localVideoDir.mockReturnValue(testVideoDir);
    fs.mkdirSync(testVideoDir, { recursive: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(testVideoDir, { recursive: true, force: true });
  });

  it("合并同一时刻的重复请求，避免并发触发两次付费链路", async () => {
    let resolveStory!: (story: null) => void;
    dbMocks.getStoryById.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveStory = resolve;
        })
    );
    dbMocks.getVideoTakeById.mockResolvedValue(null);
    const input = {
      storyId: 100,
      sourceTakeId: 9,
      targetAspectRatio: "1:1" as const,
      mode: "ai_expand" as const,
      targetStableShotId: "shot-1",
    };

    const first = conformVideoTake(input, 1);
    const second = conformVideoTake(input, 1);

    expect(second).toBe(first);
    expect(dbMocks.getStoryById).toHaveBeenCalledTimes(1);
    resolveStory(null);
    await expect(first).resolves.toMatchObject({ status: "error" });
  });

  it("302 提交结果未知后持久化锁定，重试不会再次发送付费请求", async () => {
    fs.writeFileSync(path.join(testVideoDir, "take-9.mp4"), "test-video");
    const source = {
      id: 9,
      userId: 1,
      storyId: 100,
      stableShotId: "shot-1",
      sourceImageId: null,
      promptCompilationId: null,
      status: "available",
      videoKey: "take-9.mp4",
      videoUrl: "/api/videos/take-9.mp4",
      subtitle: null,
      durationSec: 5,
    };
    dbMocks.getVideoTakeById.mockResolvedValue(source);
    dbMocks.findVideoTakeByIdempotencyKey.mockResolvedValueOnce(null);
    let createdTake: Record<string, unknown> | null = null;
    dbMocks.createVideoTake.mockImplementation(async input => {
      createdTake = { id: 77, ...input };
      return createdTake;
    });
    dbMocks.updateVideoTake.mockImplementation(
      async (
        _takeId: number,
        _userId: number,
        patch: Record<string, unknown>
      ) => ({ ...createdTake, ...patch })
    );
    const paidFetch = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({ message: "provider unavailable" }),
    }));
    vi.stubGlobal("fetch", paidFetch);
    const input = {
      storyId: 100,
      sourceTakeId: 9,
      targetAspectRatio: "1:1" as const,
      mode: "ai_expand" as const,
      targetStableShotId: "shot-1",
    };

    const first = await conformVideoTake(input, 1);
    expect(first).toMatchObject({ status: "error" });
    expect(paidFetch).toHaveBeenCalledTimes(1);
    expect(dbMocks.createVideoTake).toHaveBeenCalledTimes(1);
    const timeoutUpdate = dbMocks.updateVideoTake.mock.calls.find(
      call => call[2]?.status === "timeout"
    );
    expect(timeoutUpdate?.[2]).toMatchObject({
      status: "timeout",
      parameterSnapshot: { providerSubmissionState: "unknown" },
    });

    const persistedTimeoutTake = {
      ...createdTake,
      ...timeoutUpdate?.[2],
    };
    dbMocks.findVideoTakeByIdempotencyKey.mockResolvedValueOnce(
      persistedTimeoutTake
    );
    const second = await conformVideoTake(input, 1);

    expect(second).toMatchObject({
      status: "error",
      error: expect.stringContaining("避免重复扣费"),
    });
    expect(paidFetch).toHaveBeenCalledTimes(1);
    expect(dbMocks.createVideoTake).toHaveBeenCalledTimes(1);
  });

  it("不是本人的视频拒绝处理", async () => {
    dbMocks.getVideoTakeById.mockResolvedValue({
      id: 9,
      userId: 2,
      storyId: 100,
      status: "available",
      videoUrl: "/api/videos/a.mp4",
    });
    const result = await conformVideoTake(
      { storyId: 100, sourceTakeId: 9, targetAspectRatio: "1:1", mode: "crop" },
      1
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toContain("无权");
    }
  });

  it("跨故事素材没带目标镜头身份时给出指引，而不是笼统报不属于", async () => {
    dbMocks.getVideoTakeById.mockResolvedValue({
      id: 9,
      userId: 1,
      storyId: 200, // 归属另一个故事（副本故事靠身份别名继承来的）
      status: "available",
      videoUrl: "/api/videos/a.mp4",
      stableShotId: "shot-in-story-200",
    });
    const result = await conformVideoTake(
      { storyId: 100, sourceTakeId: 9, targetAspectRatio: "1:1", mode: "crop" },
      1
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toContain("缺少目标镜头身份");
    }
  });

  it("跨故事素材带上目标镜头身份即放行归属守卫（走到下一步的可用性校验）", async () => {
    dbMocks.getVideoTakeById.mockResolvedValue({
      id: 9,
      userId: 1,
      storyId: 200,
      status: "processing", // 故意未就绪：用「源视频尚未可用」证明归属守卫已放行
      videoUrl: null,
      stableShotId: "shot-in-story-200",
    });
    const result = await conformVideoTake(
      {
        storyId: 100,
        sourceTakeId: 9,
        targetAspectRatio: "1:1",
        mode: "crop",
        targetStableShotId: "legacy-sh01-shot",
      },
      1
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toBe("源视频尚未可用");
    }
  });
});
