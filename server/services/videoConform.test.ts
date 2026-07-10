import { describe, expect, it } from "vitest";
import {
  aspectRatioFromDimensions,
  buildVideoConformFilter,
  parseRunwayExpandRefresh,
  parseRunwayExpandSubmission,
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
