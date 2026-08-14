import { describe, expect, it } from "vitest";

import type { CreationEditorShot } from "@/features/creationEditor/types";
import { planStoryboardOneClickVideo } from "./storyboardReviewModel";

function shot(
  shotNo: number,
  durationMs: number,
  overrides: Partial<CreationEditorShot> = {}
): CreationEditorShot {
  return {
    shotKey: `shot-${shotNo}`,
    stableShotId: `shot-${shotNo}`,
    shotNo,
    subject: `主体 ${shotNo}`,
    action: "人物缓慢向前走",
    promptDraft: `主体 ${shotNo} 的故事画面`,
    videoPrompt: "缓慢推进，人物完成动作",
    durationMs,
    imageId: shotNo,
    imageUrl: `https://example.com/${shotNo}.jpg`,
    imageVersions: [
      {
        id: shotNo,
        imageUrl: `https://example.com/${shotNo}.jpg`,
        status: "selected",
        isCurrent: true,
      },
    ],
    ...overrides,
  } as CreationEditorShot;
}

describe("planStoryboardOneClickVideo", () => {
  it("selects the earliest ready shots closest to thirty seconds", () => {
    const plan = planStoryboardOneClickVideo(
      [1, 2, 3, 4, 5, 6].map(index => shot(index, 6_000)),
      { ready: true },
      30
    );

    expect(plan.shots.map(item => item.shotNo)).toEqual([1, 2, 3, 4, 5]);
    expect(plan.durationSec).toBe(30);
    expect(plan.estimatedCny).toBeGreaterThanOrEqual(0);
    expect(plan.skippedCount).toBe(0);
  });

  it("keeps missing-image shots in the plan when a cover can seed them", () => {
    const plan = planStoryboardOneClickVideo(
      [
        shot(1, 8_000),
        shot(2, 8_000, {
          imageId: undefined,
          imageUrl: undefined,
          imageVersions: [],
        }),
        shot(3, 8_000, { videoPrompt: "" }),
        shot(4, 8_000),
      ],
      { ready: true },
      30,
      { imageProviderReady: true, hasInheritedCover: true }
    );

    expect(plan.shots.map(item => item.shotNo)).toEqual([1, 2, 4]);
    expect(plan.shots.find(item => item.shotNo === 2)?.needsImage).toBe(true);
    expect(plan.durationSec).toBe(24);
    expect(plan.imageGenerationCount).toBe(1);
    expect(plan.skippedCount).toBe(1);
  });

  it("does not schedule missing-image shots without a usable cover", () => {
    const plan = planStoryboardOneClickVideo(
      [
        shot(1, 6_000, {
          imageId: undefined,
          imageUrl: undefined,
          imageVersions: [],
        }),
      ],
      { ready: true },
      30,
      { imageProviderReady: true, hasInheritedCover: false }
    );

    expect(plan.shots).toEqual([]);
    expect(plan.imageGenerationCount).toBe(0);
    expect(plan.skippedCount).toBe(1);
  });

  it("submits nothing while the video provider is unavailable", () => {
    const plan = planStoryboardOneClickVideo(
      [shot(1, 6_000)],
      { ready: false, reason: "模型维护中" },
      30
    );

    expect(plan.shots).toEqual([]);
    expect(plan.durationSec).toBe(0);
    expect(plan.skippedCount).toBe(1);
  });
});
