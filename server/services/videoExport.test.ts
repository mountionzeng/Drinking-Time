import { describe, expect, it } from "vitest";
import { buildExportPlan } from "./videoExport";
import type { StoryMaterialState } from "../../shared/storyMaterial";

function material(overrides: {
  shots: Array<Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
  overlays?: Array<Record<string, unknown>>;
  reusableVideoTakes?: Array<Record<string, unknown>>;
}): StoryMaterialState {
  return {
    storyId: 1,
    timeline: {
      storyId: 1,
      version: 1,
      items: overrides.items,
      overlays: overrides.overlays,
    },
    shots: overrides.shots,
    unassignedImages: [],
    unassignedVideos: [],
    reusableVideoTakes: overrides.reusableVideoTakes ?? [],
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
  it("exports complete overlay media and an explicit gap tail without deleting the underlying shot", () => {
    const plan = buildExportPlan(
      material({
        shots: [{ stableShotId: "a", shotNo: 1, currentVideo: video(11) }],
        items: [
          {
            stableShotId: "a",
            included: true,
            position: 0,
            plannedDurationMs: 5_000,
            durationFrames: 150,
            timelineStartFrame: 0,
            transform,
          },
        ],
        reusableVideoTakes: [video(99, { durationSec: 3 })],
        overlays: [
          {
            id: "overlay-a",
            kind: "generated-video",
            takeId: 99,
            sourceStableShotId: "a",
            videoUrl: "/api/videos/take-99.mp4",
            startFrame: 30,
            targetEndFrame: 150,
            mediaEndFrame: 120,
            endFrame: 150,
            stackOrder: 10,
            leftImageId: 1,
            rightImageId: 2,
            transform,
          },
        ],
      })
    );
    expect(plan.parts).toMatchObject([
      { kind: "source", stableShotId: "a", file: "take-11.mp4", durationSec: 1 },
      { kind: "source", stableShotId: "a", file: "take-99.mp4", durationSec: 3 },
      { kind: "gap", durationSec: 1 },
    ]);
    expect(plan.totalSec).toBe(5);
  });

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
          {
            stableShotId: "b",
            included: true,
            position: 0,
            plannedDurationMs: 10_000,
            transform,
          },
          {
            stableShotId: "a",
            included: true,
            position: 1,
            plannedDurationMs: 2_000,
            transform,
          },
          {
            stableShotId: "c",
            included: true,
            position: 2,
            plannedDurationMs: 3_000,
            transform,
          },
          {
            stableShotId: "d",
            included: false,
            position: 3,
            plannedDurationMs: 3_000,
            transform,
          },
        ],
      })
    );

    expect(plan.segments).toMatchObject([
      // range 2..5s：镜头占满自己那 10 秒，只有 3 秒有新素材，
      // 剩下的冻在最后一帧——绝对时间不能被素材长度压回去。
      {
        shotNo: 2,
        stableShotId: "b",
        file: "take-12.mp4",
        startSec: 2,
        sourceDurationSec: 3,
        durationSec: 10,
      },
      // 计划 2s < 素材 8s → 取 2s
      {
        shotNo: 1,
        stableShotId: "a",
        file: "take-11.mp4",
        startSec: 0,
        durationSec: 2,
      },
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
      {
        stableShotId: "a",
        included: true,
        position: 0,
        plannedDurationMs: 2_000,
        transform,
      },
    ];

    const strict = buildExportPlan(material({ shots, items }));
    expect(strict.segments).toHaveLength(0);

    const relaxed = buildExportPlan(material({ shots, items }), {
      fallbackToLatestTake: true,
    });
    // 已被时间轴选择的 take（20）优先于更新的 take（21）
    expect(relaxed.segments).toMatchObject([
      {
        shotNo: 1,
        stableShotId: "a",
        file: "take-20.mp4",
        startSec: 0,
        durationSec: 2,
      },
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
          {
            stableShotId: "a",
            included: true,
            position: 0,
            plannedDurationMs: 2_000,
            transform,
          },
        ],
      })
    );
    expect(plan.segments).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("视频缺少本地文件");
  });

  it("把主镜头的裁切、倍速、倒放、音量和构图写入导出计划", () => {
    const plan = buildExportPlan(
      material({
        shots: [{ stableShotId: "a", shotNo: 1, currentVideo: video(31) }],
        items: [
          {
            stableShotId: "a",
            included: true,
            position: 0,
            plannedDurationMs: 2_000,
            transform: { ...transform, zoom: 2, panX: 0.5 },
            primaryVideoEdit: {
              takeId: 31,
              sourceStartSec: 1,
              sourceEndSec: 5,
              effects: {
                playbackRate: 2,
                reverse: true,
                volume: 0.4,
                muted: false,
              },
            },
          },
        ],
      })
    );

    expect(plan.segments).toEqual([
      {
        shotNo: 1,
        stableShotId: "a",
        file: "take-31.mp4",
        startSec: 1,
        sourceDurationSec: 4,
        durationSec: 2,
        effects: {
          playbackRate: 2,
          reverse: true,
          volume: 0.4,
          muted: false,
        },
        transform: { ...transform, zoom: 2, panX: 0.5 },
      },
    ]);
  });

  it("把心跳缩放作为可导出的时间性效果保留在导出计划中", () => {
    const plan = buildExportPlan(
      material({
        shots: [{ stableShotId: "a", shotNo: 1, currentVideo: video(32) }],
        items: [
          {
            stableShotId: "a",
            included: true,
            position: 0,
            plannedDurationMs: 2_000,
            transform,
            primaryVideoEdit: {
              takeId: 32,
              sourceStartSec: 0,
              sourceEndSec: 2,
              effects: {
                playbackRate: 1,
                reverse: false,
                volume: 1,
                muted: false,
                motionPreset: { kind: "heartbeat", bpm: 90, scaleAmount: 0.06 },
              },
            },
          },
        ],
      })
    );

    expect(plan.segments[0].effects.motionPreset).toEqual({
      kind: "heartbeat",
      bpm: 90,
      scaleAmount: 0.06,
    });
  });

  it("按时间顺序导出替代主镜头的视频切片", () => {
    const plan = buildExportPlan(
      material({
        shots: [
          {
            stableShotId: "a",
            shotNo: 1,
            currentVideo: null,
            videoTakes: [video(41), video(42)],
          },
        ],
        items: [
          {
            stableShotId: "a",
            included: true,
            position: 0,
            plannedDurationMs: 3_000,
            transform,
            visualClipsReplacePrimary: true,
            visualClips: [
              {
                id: "later",
                takeId: 42,
                rangeId: 2,
                sourceStableShotId: "a",
                videoUrl: "/api/videos/take-42.mp4",
                label: "后段",
                sourceStartSec: 3,
                sourceEndSec: 5,
                offsetMs: 1_000,
                durationMs: 2_000,
              },
              {
                id: "first",
                takeId: 41,
                rangeId: 1,
                sourceStableShotId: "a",
                videoUrl: "/api/videos/take-41.mp4",
                label: "前段",
                sourceStartSec: 0,
                sourceEndSec: 2,
                offsetMs: 0,
                durationMs: 1_000,
                effects: {
                  playbackRate: 2,
                  reverse: false,
                  volume: 1,
                  muted: false,
                },
              },
            ],
          },
        ],
      })
    );

    expect(plan.segments.map(segment => segment.file)).toEqual([
      "take-41.mp4",
      "take-42.mp4",
    ]);
    expect(plan.segments.map(segment => segment.durationSec)).toEqual([1, 2]);
  });

  it("有意的空档导出成等长黑场，不会被跳过压短", () => {
    const plan = buildExportPlan(
      material({
        shots: [
          { stableShotId: "a", shotNo: 1, currentVideo: video(11) },
          { stableShotId: "b", shotNo: 2, currentVideo: video(12) },
        ],
        items: [
          {
            stableShotId: "a",
            included: true,
            position: 0,
            plannedDurationMs: 1_000,
            durationFrames: 30,
            timelineStartFrame: 0,
            transform,
          },
          {
            stableShotId: "b",
            included: true,
            position: 1,
            plannedDurationMs: 1_000,
            durationFrames: 30,
            timelineStartFrame: 90,
            transform,
          },
        ],
      })
    );

    expect(plan.parts.map(part => [part.kind, part.durationSec])).toEqual([
      ["source", 1],
      ["gap", 2],
      ["source", 1],
    ]);
    expect(plan.totalSec).toBe(4);
  });

  it("重叠区间只导出胜出的那一镜，锚定镜头压过更晚移动的镜头", () => {
    const plan = buildExportPlan(
      material({
        shots: [
          { stableShotId: "anchored", shotNo: 1, currentVideo: video(11) },
          { stableShotId: "recent", shotNo: 2, currentVideo: video(12) },
        ],
        items: [
          {
            stableShotId: "anchored",
            included: true,
            position: 0,
            plannedDurationMs: 2_000,
            durationFrames: 60,
            timelineStartFrame: 0,
            stackOrder: 0,
            anchors: [
              {
                id: "a",
                timelineFrame: 10,
                sourceType: "primary-video",
                sourceId: "take-11",
                sourceTimeSec: 0.33,
              },
            ],
            transform,
          },
          {
            stableShotId: "recent",
            included: true,
            position: 1,
            plannedDurationMs: 2_000,
            durationFrames: 60,
            timelineStartFrame: 30,
            stackOrder: 99,
            transform,
          },
        ],
      })
    );

    // 0–2s 归有锚点的那一镜；2–3s 才轮到后移过来的那一镜露出尾巴。
    expect(
      plan.parts.map(part =>
        part.kind === "source"
          ? [part.file, part.durationSec]
          : [part.kind, part.durationSec]
      )
    ).toEqual([
      ["take-11.mp4", 2],
      ["take-12.mp4", 1],
    ]);
    expect(plan.totalSec).toBe(3);
  });

  it("缺素材补等长占位，后面镜头的绝对时间原地不动", () => {
    const plan = buildExportPlan(
      material({
        shots: [
          { stableShotId: "a", shotNo: 1, currentVideo: null },
          { stableShotId: "c", shotNo: 3, currentVideo: video(13) },
        ],
        items: [
          {
            stableShotId: "a",
            included: true,
            position: 0,
            plannedDurationMs: 3_000,
            durationFrames: 90,
            timelineStartFrame: 0,
            transform,
          },
          {
            stableShotId: "c",
            included: true,
            position: 1,
            plannedDurationMs: 3_000,
            durationFrames: 90,
            timelineStartFrame: 150,
            transform,
          },
        ],
      })
    );

    expect(plan.parts.map(part => [part.kind, part.durationSec])).toEqual([
      ["missing", 3],
      ["gap", 2],
      ["source", 3],
    ]);
    // C 仍然从第 5 秒开始，不会被提前到 0 秒。
    const secondsBeforeLast = plan.parts
      .slice(0, -1)
      .reduce((total, part) => total + part.durationSec, 0);
    expect(secondsBeforeLast).toBe(5);
    expect(plan.totalSec).toBe(8);
    expect(plan.skipped).toEqual([{ shotNo: 1, reason: "没有可用的当前视频" }]);
  });

  it("同源且源时间接得上的相邻区间合并成一段", () => {
    const plan = buildExportPlan(
      material({
        shots: [{ stableShotId: "a", shotNo: 1, currentVideo: video(11) }],
        items: [
          {
            stableShotId: "a",
            included: true,
            position: 0,
            plannedDurationMs: 2_000,
            durationFrames: 60,
            timelineStartFrame: 0,
            transform,
          },
        ],
      })
    );

    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0]).toMatchObject({ kind: "source", durationSec: 2 });
  });
});
