import { describe, expect, it } from "vitest";
import { buildExportPlan } from "./videoExport";
import type { StoryMaterialState } from "../../shared/storyMaterial";

function material(overrides: {
  shots: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
}): StoryMaterialState {
  return {
    storyId: 1,
    timeline: { storyId: 1, version: 1, items: overrides.items },
    shots: overrides.shots,
    unassignedImages: [],
    unassignedVideos: [],
  } as unknown as StoryMaterialState;
}

const transform = {
  cropX: 0,
  cropY: 0,
  cropWidth: 1,
  cropHeight: 1,
  zoom: 1,
  panX: 0,
  panY: 0,
};

function video(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    status: "available",
    videoKey: `take-${id}.mp4`,
    videoUrl: `/api/videos/take-${id}.mp4`,
    durationSec: 8,
    selectedSelectionType: "full_take",
    selectedRangeId: null,
    ranges: [],
    ...extra,
  };
}

describe("buildExportPlan", () => {
  it("按时间轴顺序出段：计划时长封顶、range 修剪生效、移除与缺视频跳过", () => {
    const plan = buildExportPlan(
      material({
        shots: [
          { stableShotId: "a", shotNo: 1, currentVideo: video(11) },
          {
            stableShotId: "b",
            shotNo: 2,
            currentVideo: video(12, {
              selectedSelectionType: "range",
              selectedRangeId: 77,
              ranges: [{ id: 77, startSec: 2, endSec: 5 }],
            }),
          },
          { stableShotId: "c", shotNo: 3, currentVideo: null },
          { stableShotId: "d", shotNo: 4, currentVideo: video(14) },
        ],
        items: [
          { stableShotId: "b", included: true, position: 0, plannedDurationMs: 10_000, transform },
          { stableShotId: "a", included: true, position: 1, plannedDurationMs: 2_000, transform },
          { stableShotId: "c", included: true, position: 2, plannedDurationMs: 3_000, transform },
          { stableShotId: "d", included: false, position: 3, plannedDurationMs: 3_000, transform },
        ],
      })
    );

    expect(plan.segments).toEqual([
      // range 2..5s → 实际 3s（计划 10s 被素材范围封顶）
      { shotNo: 2, stableShotId: "b", file: "take-12.mp4", startSec: 2, durationSec: 3 },
      // 计划 2s < 素材 8s → 取 2s
      { shotNo: 1, stableShotId: "a", file: "take-11.mp4", startSec: 0, durationSec: 2 },
    ]);
    expect(plan.skipped).toEqual([
      { shotNo: 3, reason: "没有可用的当前视频" },
      { shotNo: 4, reason: "已从成片移除" },
    ]);
  });

  it("素材兜底：没有当前视频时用已选择的素材，关掉兜底则跳过", () => {
    const shots = [
      {
        stableShotId: "a",
        shotNo: 1,
        currentVideo: null,
        videoTakes: [
          video(21, { isTimelineSelected: false }),
          video(20, { isTimelineSelected: true }),
        ],
      },
    ];
    const items = [
      { stableShotId: "a", included: true, position: 0, plannedDurationMs: 2_000, transform },
    ];

    const strict = buildExportPlan(material({ shots, items }));
    expect(strict.segments).toHaveLength(0);

    const relaxed = buildExportPlan(material({ shots, items }), {
      fallbackToLatestTake: true,
    });
    // 已被时间轴选择的 take（20）优先于更新的 take（21）
    expect(relaxed.segments).toEqual([
      { shotNo: 1, stableShotId: "a", file: "take-20.mp4", startSec: 0, durationSec: 2 },
    ]);
  });

  it("非法 videoKey（路径穿越）按缺文件跳过", () => {
    const plan = buildExportPlan(
      material({
        shots: [
          {
            stableShotId: "a",
            shotNo: 1,
            currentVideo: video(11, { videoKey: "../../etc/passwd" }),
          },
        ],
        items: [
          { stableShotId: "a", included: true, position: 0, plannedDurationMs: 2_000, transform },
        ],
      })
    );
    expect(plan.segments).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("视频缺少本地文件");
  });
});
