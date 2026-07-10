import { describe, expect, it } from "vitest";

import {
  buildVideoConformBatchItems,
  get302VideoExpandAvailability,
  isVideoConformReviewCandidate,
  recommendVideoConformMode,
  summarizeVideoConformResults,
  videoConformReviewKey,
} from "./videoConformReview";

describe("video conform review", () => {
  it("keeps matching aspect ratios eligible for exact-size normalization", () => {
    expect(
      isVideoConformReviewCandidate({
        hasCurrentVideo: true,
        videoTakeId: 41,
      })
    ).toBe(true);
    expect(
      recommendVideoConformMode({
        cameraMove: "固定机位",
        sourceAspectRatio: "1:1",
        targetAspectRatio: "1:1",
      })
    ).toMatchObject({ mode: "crop", confidence: "high" });
  });

  it("recommends a free crop for a centered push-in", () => {
    expect(
      recommendVideoConformMode({
        cameraMove: "缓慢推进，保留压迫性静止",
        sourceAspectRatio: "16:9",
        targetAspectRatio: "1:1",
      })
    ).toMatchObject({
      mode: "crop",
      confidence: "high",
      cropAxis: "horizontal",
    });
  });

  it("recommends 302 expansion when vertical movement crosses a vertical crop", () => {
    expect(
      recommendVideoConformMode({
        cameraMove: "镜头缓慢下移，像进入身体和泥土",
        sourceAspectRatio: "9:16",
        targetAspectRatio: "1:1",
      })
    ).toMatchObject({
      mode: "ai_expand",
      confidence: "high",
      cropAxis: "vertical",
    });
  });

  it("flags orbiting movement for expansion when the frame must be cropped", () => {
    expect(
      recommendVideoConformMode({
        cameraMove: "轻微环绕或推近，形成审判感",
        sourceAspectRatio: "16:9",
        targetAspectRatio: "1:1",
      })
    ).toMatchObject({ mode: "ai_expand", confidence: "high" });
  });

  it("does not recommend a paid mode that the current 302 endpoint cannot perform", () => {
    expect(
      recommendVideoConformMode({
        cameraMove: "镜头缓慢上移",
        sourceAspectRatio: "4:3",
        targetAspectRatio: "16:9",
      })
    ).toMatchObject({ mode: "crop", confidence: "review" });
    expect(
      get302VideoExpandAvailability({
        sourceAspectRatio: "4:3",
        targetAspectRatio: "16:9",
      })
    ).toMatchObject({ supported: false });
  });

  it("defaults to crop without spending credits when camera movement is unknown", () => {
    expect(
      recommendVideoConformMode({
        cameraMove: "",
        sourceAspectRatio: "16:9",
        targetAspectRatio: "1:1",
      })
    ).toMatchObject({ mode: "crop", confidence: "review" });
  });

  it("builds one mixed-mode batch from the user's per-shot choices", () => {
    const items = buildVideoConformBatchItems(
      [
        {
          takeId: 41,
          stableShotId: "shot-1",
        },
        {
          takeId: 42,
          stableShotId: "shot-2",
        },
      ],
      new Map([
        [
          videoConformReviewKey({ takeId: 41, stableShotId: "shot-1" }),
          "ai_expand" as const,
        ],
        [
          videoConformReviewKey({ takeId: 42, stableShotId: "shot-2" }),
          "crop" as const,
        ],
      ])
    );

    expect(items).toEqual([
      { takeId: 41, stableShotId: "shot-1", mode: "ai_expand" },
      { takeId: 42, stableShotId: "shot-2", mode: "crop" },
    ]);
  });

  it("never submits a shot that the user has not confirmed", () => {
    expect(
      buildVideoConformBatchItems(
        [
          {
            takeId: 41,
            stableShotId: "shot-1",
          },
        ],
        new Map()
      )
    ).toEqual([]);
  });

  it("keeps two shot bindings independent when they share one source take", () => {
    const items = [
      { takeId: 41, stableShotId: "shot-1" },
      { takeId: 41, stableShotId: "shot-2" },
    ];
    expect(
      buildVideoConformBatchItems(
        items,
        new Map([
          [videoConformReviewKey(items[0]!), "crop"],
          [videoConformReviewKey(items[1]!), "ai_expand"],
        ])
      )
    ).toEqual([
      { takeId: 41, stableShotId: "shot-1", mode: "crop" },
      { takeId: 41, stableShotId: "shot-2", mode: "ai_expand" },
    ]);
  });

  it("summarizes mixed results by take and shot instead of take alone", () => {
    expect(
      summarizeVideoConformResults(
        [
          { takeId: 41, stableShotId: "shot-1", mode: "crop" },
          { takeId: 41, stableShotId: "shot-2", mode: "ai_expand" },
        ],
        [
          {
            status: "ok",
            sourceTakeId: 41,
            stableShotId: "shot-1",
            videoStatus: "available",
          },
          {
            status: "ok",
            sourceTakeId: 41,
            stableShotId: "shot-2",
            videoStatus: "processing",
          },
        ]
      )
    ).toMatchObject({
      cropSuccessCount: 1,
      expandSuccessCount: 1,
      processingCount: 1,
    });
  });
});
