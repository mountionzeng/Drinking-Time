import { describe, expect, it } from "vitest";
import type {
  StoryMaterialState,
  ShotMaterialState,
} from "@shared/storyMaterial";
import type { ImageAsset } from "@shared/imageAsset";
import type { VideoTakeAsset } from "@shared/videoAsset";
import type { CreationEditorShot } from "./CreationEditorContext";
import {
  aspectRatioMatches,
  buildOneClickEditReport,
  collectOneClickAnchorCandidates,
} from "./oneClickEditReport";

function shot(overrides: Partial<CreationEditorShot>): CreationEditorShot {
  return {
    shotNo: 1,
    shotKey: "SH01",
    stableShotId: "shot-1",
    shotIdentity: "shot-1",
    subject: "人物",
    action: "",
    dialogue: "",
    shotType: "",
    beat: "",
    cameraAngle: "",
    cameraMove: "",
    location: "",
    timeLight: "",
    mood: "",
    sound: "",
    styleRef: "",
    note: "",
    emotion: "",
    sourceCardContent: "",
    ...overrides,
  } as CreationEditorShot;
}

function image(id: number, stableShotId: string): ImageAsset {
  return {
    id,
    projectId: null,
    storyId: 1159,
    userId: 1,
    rawShotNo: null,
    canonicalShotNo: null,
    shotIdentity: stableShotId,
    imageKey: null,
    imageUrl: `/image-${id}.jpg`,
    prompt: null,
    promptCompilationId: null,
    promptFreshness: "current",
    generationType: "generate",
    parentImageId: null,
    isCurrent: true,
    maskKey: null,
    createdAt: "2026-07-10T00:00:00.000Z",
    kind: "story_frame",
    status: "selected",
    assignment: "shot",
    availability: "available",
    isPrimary: true,
    selectionSource: "explicit",
    selectedAt: null,
  };
}

function video(
  id: number,
  stableShotId: string,
  aspectRatio: string
): VideoTakeAsset {
  return {
    id,
    storyId: 1159,
    userId: 1,
    stableShotId,
    sourceImageId: null,
    promptCompilationId: null,
    promptFreshness: "current",
    status: "available",
    taskId: null,
    provider: "test",
    model: "test",
    prompt: "",
    subtitle: null,
    durationSec: 3,
    aspectRatio,
    videoKey: null,
    videoUrl: `/video-${id}.mp4`,
    errorMessage: null,
    parameterSnapshot: null,
    extractionCapability: "available",
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ranges: [],
    selectedRangeId: null,
    selectedSelectionType: "full_take",
    isTimelineSelected: true,
  };
}

function materialState(shots: ShotMaterialState[]): StoryMaterialState {
  return {
    storyId: 1159,
    timeline: {
      storyId: 1159,
      version: 1,
      items: shots.map((item, position) => ({
        stableShotId: item.stableShotId,
        included: true,
        position,
        plannedDurationMs: 3000,
        transform: {
          cropX: 0,
          cropY: 0,
          cropWidth: 1,
          cropHeight: 1,
          zoom: 1,
          panX: 0,
          panY: 0,
        },
      })),
    },
    shots,
    unassignedImages: [],
    unassignedVideoTakes: [],
    reusableVideoTakes: [],
  };
}

describe("oneClickEditReport", () => {
  it("flags video aspect ratio and visual anchor gaps for square stories", () => {
    const report = buildOneClickEditReport({
      shots: [shot({ shotNo: 1, stableShotId: "shot-1" })],
      materialState: materialState([
        {
          stableShotId: "shot-1",
          shotNo: 1,
          currentImage: image(1, "shot-1"),
          imageVersions: [image(1, "shot-1")],
          currentVideo: video(1, "shot-1", "16:9"),
          videoTakes: [video(1, "shot-1", "16:9")],
          timelineItem: null,
        },
      ]),
      timelineShotIds: ["shot-1"],
      targetAspectRatio: "1:1",
    });

    expect(report.aspectMismatchCount).toBe(1);
    expect(report.visualWarningCount).toBe(2);
    expect(report.blockingCount).toBe(1);
    expect(report.checks[0]?.issues.map(item => item.kind)).toContain(
      "aspect_mismatch"
    );
  });

  it("treats a selected square take with character and scene references as ready", () => {
    const readyShot = shot({
      shotNo: 2,
      shotKey: "SH02",
      stableShotId: "shot-2",
      sceneNo: "第一幕",
      promptOverrides: {
        character_reference: { value: "same pale woman, short black bob" },
        scene_reference: { value: "muted green gallery room" },
      },
    });
    const report = buildOneClickEditReport({
      shots: [readyShot],
      materialState: materialState([
        {
          stableShotId: "shot-2",
          shotNo: 2,
          currentImage: image(2, "shot-2"),
          imageVersions: [image(2, "shot-2")],
          currentVideo: video(2, "shot-2", "1:1"),
          videoTakes: [video(2, "shot-2", "1:1")],
          timelineItem: null,
        },
      ]),
      timelineShotIds: ["shot-2"],
      targetAspectRatio: "1:1",
    });
    const characterCandidates = collectOneClickAnchorCandidates(
      report.checks,
      "character"
    );

    expect(report.readyShots).toBe(1);
    expect(report.sceneGroups[0]?.label).toBe("第一幕");
    expect(characterCandidates.map(item => item.label)).toContain(
      "same pale woman, short black bob"
    );
  });

  it("keeps legacy inserted shots in the preceding scene group", () => {
    const report = buildOneClickEditReport({
      shots: [
        shot({
          shotNo: 1,
          stableShotId: "shot-1",
          sceneNo: "SC01",
          sceneTitle: "第一幕",
        }),
        shot({ shotNo: 2, stableShotId: "manual-shot-2" }),
        shot({
          shotNo: 3,
          stableShotId: "shot-3",
          sceneNo: "SC02",
          sceneTitle: "第二幕",
        }),
        shot({ shotNo: 4, stableShotId: "manual-shot-4" }),
      ],
      materialState: materialState([]),
      timelineShotIds: [],
      targetAspectRatio: "1:1",
    });

    expect(
      report.sceneGroups.map(group => ({
        key: group.key,
        label: group.label,
        shots: group.checks.map(check => check.shotNo),
      }))
    ).toEqual([
      { key: "SC01", label: "SC01 · 第一幕", shots: [1, 2] },
      { key: "SC02", label: "SC02 · 第二幕", shots: [3, 4] },
    ]);
  });

  it("does not merge a title-only scene into the preceding numbered scene", () => {
    const report = buildOneClickEditReport({
      shots: [
        shot({
          shotNo: 1,
          stableShotId: "shot-1",
          sceneNo: "SC01",
          sceneTitle: "第一幕",
        }),
        shot({
          shotNo: 2,
          stableShotId: "shot-2",
          sceneTitle: "缺编号的第二幕",
        }),
      ],
      materialState: materialState([]),
      timelineShotIds: [],
      targetAspectRatio: "1:1",
    });

    expect(
      report.sceneGroups.map(group => ({
        key: group.key,
        label: group.label,
        shots: group.checks.map(check => check.shotNo),
      }))
    ).toEqual([
      { key: "SC01", label: "SC01 · 第一幕", shots: [1] },
      { key: "未分场", label: "缺编号的第二幕", shots: [2] },
    ]);
  });

  it("projects trimmed camera movement for the conform review", () => {
    const report = buildOneClickEditReport({
      shots: [
        shot({
          shotNo: 1,
          stableShotId: "shot-1",
          cameraMove: "  缓慢推进  ",
        }),
        shot({ shotNo: 2, stableShotId: "shot-2", cameraMove: "" }),
      ],
      materialState: materialState([]),
      timelineShotIds: [],
      targetAspectRatio: "1:1",
    });

    expect(report.checks.map(check => check.cameraMove)).toEqual([
      "缓慢推进",
      "",
    ]);
  });

  it("projects an adopted video as the visual preview without pretending it is an image anchor", () => {
    const currentVideo = video(44, "shot-1", "16:9");
    const report = buildOneClickEditReport({
      shots: [shot({ shotNo: 1, stableShotId: "shot-1" })],
      materialState: materialState([
        {
          stableShotId: "shot-1",
          shotNo: 1,
          currentImage: null,
          imageVersions: [],
          currentVideo,
          videoTakes: [currentVideo],
          timelineItem: null,
        },
      ]),
      timelineShotIds: ["shot-1"],
      targetAspectRatio: "1:1",
    });

    expect(report.currentVideoCount).toBe(1);
    expect(report.currentImageCount).toBe(0);
    expect(report.checks[0]?.visualPreview).toEqual({
      kind: "video",
      url: "/video-44.mp4",
    });
    expect(report.checks[0]?.issues).toContainEqual(
      expect.objectContaining({
        kind: "missing_current_image",
        label: "视频已关联 · 未截首帧",
      })
    );
    expect(collectOneClickAnchorCandidates(report.checks, "character")).toEqual(
      []
    );
  });

  it("normalizes common ratio aliases", () => {
    expect(aspectRatioMatches("square", "1:1")).toBe(true);
    expect(aspectRatioMatches("16 : 9", "16:9")).toBe(true);
    expect(aspectRatioMatches("9:16", "1:1")).toBe(false);
  });
});
