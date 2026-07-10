import { beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  aspectRatioFromDimensions,
  buildVideoConformFilter,
  conformVideoTake,
  parseRunwayExpandRefresh,
  parseRunwayExpandSubmission,
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
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getStoryById.mockResolvedValue({ id: 100 });
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
