import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGeneratedImage,
  createStory,
  getGeneratedImageById,
  getStoryTimeline,
  resetMemoryStateForTesting,
  updateStoryTimeline,
} from "../db";
import {
  addTimelineAnchorForStory,
  applyVisualLayerActionForStory,
  deleteVisualObjectForStory,
  includeAllShotsForStory,
  moveShotOrderForStory,
  patchImageTransformForStory,
  setShotDurationForStory,
  removeInnerVideoClipForStory,
  reorderShotToTargetForStory,
  setShotIncludedForStory,
  resolveShotAtPlayhead,
  undoVisualEditForStory,
  withPlayheadShot,
  insertVisualImageClipForStory,
  magnetDetachForStory,
  moveShotGroupForStory,
  moveShotSingleForStory,
  moveVisualClipForStory,
  pasteVisualImageForStory,
  placeExtractedFrameForStory,
  removeTimelineAnchorForStory,
  rollingTrimForStory,
  trimShotForStory,
} from "./visualClipEditing";
import type { ImageClipClipboardSnapshot } from "../../shared/visualObjectClipboard";
import { projectVisualClips, type VisualEditDocument } from "../../shared/visualClipModel";
import { buildTimelineLayout } from "../../shared/timelineLayout";
import { clearVisualEditUndoForTesting } from "./visualEditUndoJournal";
import * as dbModule from "../db";

const USER_ID = 1;

const TRANSFORM = {
  cropX: 0,
  cropY: 0,
  cropWidth: 1,
  cropHeight: 1,
  zoom: 1,
  panX: 0,
  panY: 0,
};

async function seedStory() {
  const story = await createStory({
    userId: USER_ID,
    title: "多轨移动",
    body: {
      shots: [
        { shotNo: 1, stableShotId: "sh-01" },
        { shotNo: 2, stableShotId: "sh-02" },
      ],
    },
  });
  await updateStoryTimeline({
    storyId: story.id,
    userId: USER_ID,
    expectedVersion: 0,
    items: [
      {
        stableShotId: "sh-01",
        included: true,
        position: 0,
        plannedDurationMs: 4000,
        durationFrames: 120,
        timelineStartFrame: 0,
        visualLayer: 0,
        transform: TRANSFORM,
        primaryVideoEdit: {
          takeId: 9,
          sourceStartSec: 0,
          sourceEndSec: 4,
          effects: { playbackRate: 1, reverse: false, volume: 1, muted: false },
        },
        imageClips: [
          {
            id: "img-legacy",
            imageId: 1702,
            imageUrl: "/1702.png",
            label: "旧图",
            offsetFrames: 30,
            durationFrames: 1,
            visualLayer: 1,
          },
          {
            id: "img-abs",
            imageId: 1708,
            imageUrl: "/1708.png",
            label: "新图",
            offsetFrames: 0,
            timelineStartFrame: 107,
            durationFrames: 1,
            visualLayer: 1,
          },
        ],
      },
      {
        stableShotId: "sh-02",
        included: true,
        position: 1,
        plannedDurationMs: 4000,
        durationFrames: 120,
        visualLayer: 0,
        transform: TRANSFORM,
      },
    ],
    overlays: [
      {
        id: "ov-1",
        kind: "generated-video",
        takeId: 5,
        sourceStableShotId: "sh-01",
        videoUrl: "/ov.mp4",
        startFrame: 71,
        targetEndFrame: 101,
        mediaEndFrame: 101,
        endFrame: 101,
        stackOrder: 3,
        leftImageId: 1702,
        rightImageId: 1708,
        transform: TRANSFORM,
      },
    ],
    visualLayerState: { count: 3, hidden: [] },
  });
  return story.id;
}

async function persistedVersion(storyId: number) {
  return (await getStoryTimeline(storyId, USER_ID))?.version ?? 0;
}

/** 直接从库里重新读一遍，证明位置是真的落库了，而不是只活在返回值里。 */
async function persistedPlacements(storyId: number) {
  const row = await getStoryTimeline(storyId, USER_ID);
  const document = {
    items: row?.items,
    overlays: row?.overlays,
  } as VisualEditDocument;
  return Object.fromEntries(
    projectVisualClips(document).map(clip => [
      clip.id,
      `${clip.trackId}@${clip.startFrame}+${clip.durationFrames}`,
    ])
  );
}

describe("moveVisualClipForStory", () => {
  beforeEach(() => resetMemoryStateForTesting());

  it("把一张图片移到新轨道新位置，只有它变，版本只 +1", async () => {
    const storyId = await seedStory();
    const before = await persistedPlacements(storyId);
    const baseVersion = await persistedVersion(storyId);

    const result = await moveVisualClipForStory({
      storyId,
      userId: USER_ID,
      clipId: "image:img-abs",
      toTrackId: "track-2",
      toStartFrame: 200,
    });

    expect(result).toMatchObject({ status: "ok", changed: true });
    if (result.status !== "ok") return;
    expect(result.timelineVersion).toBe(baseVersion + 1);

    const after = await persistedPlacements(storyId);
    expect(after["image:img-abs"]).toBe("track-2@200+1");
    for (const id of Object.keys(before)) {
      if (id === "image:img-abs") continue;
      expect(after[id]).toBe(before[id]);
    }
  });

  it("移动底层视频不动上层任何素材", async () => {
    const storyId = await seedStory();
    const before = await persistedPlacements(storyId);

    const result = await moveVisualClipForStory({
      storyId,
      userId: USER_ID,
      clipId: "shot:sh-01",
      toTrackId: "track-0",
      toStartFrame: 60,
    });
    expect(result.status).toBe("ok");

    const after = await persistedPlacements(storyId);
    expect(after["shot:sh-01"]).toBe("track-0@60+120");
    expect(after["image:img-legacy"]).toBe(before["image:img-legacy"]);
    expect(after["image:img-abs"]).toBe(before["image:img-abs"]);
    expect(after["overlay:ov-1"]).toBe(before["overlay:ov-1"]);
    expect(after["shot:sh-02"]).toBe(before["shot:sh-02"]);
  });

  it("重复提交同一次移动不再写库，版本不动", async () => {
    const storyId = await seedStory();
    const first = await moveVisualClipForStory({
      storyId,
      userId: USER_ID,
      clipId: "image:img-legacy",
      toTrackId: "track-2",
      toStartFrame: 240,
    });
    expect(first).toMatchObject({ status: "ok", changed: true });
    const second = await moveVisualClipForStory({
      storyId,
      userId: USER_ID,
      clipId: "image:img-legacy",
      toTrackId: "track-2",
      toStartFrame: 240,
    });
    expect(second).toMatchObject({ status: "ok", changed: false });
    if (first.status !== "ok" || second.status !== "ok") return;
    expect(second.timelineVersion).toBe(first.timelineVersion);
    expect((await persistedPlacements(storyId))["image:img-legacy"]).toBe(
      "track-2@240+1"
    );
  });

  it("找不到素材时返回可见的错误，不悄悄成功", async () => {
    const storyId = await seedStory();
    const before = await persistedPlacements(storyId);
    const result = await moveVisualClipForStory({
      storyId,
      userId: USER_ID,
      clipId: "image:not-there",
      toTrackId: "track-1",
      toStartFrame: 10,
    });
    expect(result.status).toBe("error");
    expect(await persistedPlacements(storyId)).toEqual(before);
  });
});

describe("insertVisualImageClipForStory", () => {
  beforeEach(() => resetMemoryStateForTesting());

  it("按绝对帧落一张一帧图片，其它素材一个不动，版本只 +1", async () => {
    const storyId = await seedStory();
    const before = await persistedPlacements(storyId);
    const baseVersion = await persistedVersion(storyId);

    const result = await insertVisualImageClipForStory({
      storyId,
      userId: USER_ID,
      clip: {
        clipId: "img-extracted",
        imageId: 2001,
        imageUrl: "/2001.png",
        label: "抽帧 00:05.000",
        trackId: "track-1",
        startFrame: 150,
      },
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.timelineVersion).toBe(baseVersion + 1);

    const after = await persistedPlacements(storyId);
    expect(after["image:img-extracted"]).toBe("track-1@150+1");
    for (const id of Object.keys(before)) {
      expect(after[id]).toBe(before[id]);
    }
  });

  it("落好的图片可以立刻用同一个移动命令搬走并落库", async () => {
    const storyId = await seedStory();
    await insertVisualImageClipForStory({
      storyId,
      userId: USER_ID,
      clip: {
        clipId: "img-extracted",
        imageId: 2001,
        imageUrl: "/2001.png",
        label: "抽帧",
        trackId: "track-1",
        startFrame: 150,
      },
    });
    const moved = await moveVisualClipForStory({
      storyId,
      userId: USER_ID,
      clipId: "image:img-extracted",
      toTrackId: "track-2",
      toStartFrame: 400,
    });
    expect(moved).toMatchObject({ status: "ok", changed: true });
    expect((await persistedPlacements(storyId))["image:img-extracted"]).toBe(
      "track-2@400+1"
    );
  });

  it("同一个 clipId 重复落位是替换，不会攒出重复素材", async () => {
    const storyId = await seedStory();
    const beforeVersion = await persistedVersion(storyId);
    const versions: number[] = [];
    for (const frame of [150, 150, 260]) {
      const result = await insertVisualImageClipForStory({
        storyId,
        userId: USER_ID,
        clip: {
          clipId: "img-extracted",
          imageId: 2001,
          imageUrl: "/2001.png",
          label: "抽帧",
          trackId: "track-1",
          startFrame: frame,
        },
      });
      if (result.status === "ok") versions.push(result.timelineVersion);
    }
    const placements = await persistedPlacements(storyId);
    const matching = Object.keys(placements).filter(
      id => id === "image:img-extracted"
    );
    expect(matching).toHaveLength(1);
    expect(placements["image:img-extracted"]).toBe("track-1@260+1");
    expect(versions).toEqual([
      beforeVersion + 1,
      beforeVersion + 1,
      beforeVersion + 2,
    ]);
  });
});

describe("Story-scoped image paste and narrow delete", () => {
  beforeEach(() => resetMemoryStateForTesting());

  async function warehouseSnapshot(
    storyId: number
  ): Promise<ImageClipClipboardSnapshot> {
    const image = await createGeneratedImage({
      projectId: null,
      storyId,
      userId: USER_ID,
      shotNo: "1",
      shotIdentity: "sh-01",
      imageKey: "generated/clipboard.png",
      imageUrl: "/api/images/clipboard.png",
      prompt: "剪贴板图片",
      generationType: "initial",
      isCurrent: false,
    });
    return Object.freeze({
      version: 1,
      kind: "image-clip",
      sourceStoryId: storyId,
      sourceClipId: "source-image",
      sourceLayer: 1,
      imageId: image.id,
      imageUrl: "/untrusted-stale-url.png",
      label: "复制图片",
      durationFrames: 3,
      transform: Object.freeze({ ...TRANSFORM, zoom: 1.4 }),
    });
  }

  it("re-authorizes the image and replays one paste without a second version", async () => {
    const storyId = await seedStory();
    const snapshot = await warehouseSnapshot(storyId);
    const beforeVersion = await persistedVersion(storyId);
    const first = await pasteVisualImageForStory({
      storyId,
      userId: USER_ID,
      pasteId: "paste-a",
      snapshot,
      targetFrame: 80,
      targetLayer: 2,
    });
    const replay = await pasteVisualImageForStory({
      storyId,
      userId: USER_ID,
      pasteId: "paste-a",
      snapshot,
      targetFrame: 80,
      targetLayer: 2,
    });

    expect(first).toMatchObject({ status: "ok", changed: true });
    expect(replay).toMatchObject({
      status: "ok",
      changed: false,
      timelineVersion: beforeVersion + 1,
      clipId: first.clipId,
    });
    const row = await getStoryTimeline(storyId, USER_ID);
    const pasted = (row?.items as VisualEditDocument["items"])
      .flatMap(item => item.imageClips ?? [])
      .find(clip => clip.id === first.clipId);
    expect(pasted).toMatchObject({
      imageId: snapshot.imageId,
      imageUrl: "/api/images/clipboard.png",
      timelineStartFrame: 80,
      durationFrames: 3,
      visualLayer: 2,
      transform: { zoom: 1.4 },
    });
  });

  it("does not let one paste identity move an already-created copy", async () => {
    const storyId = await seedStory();
    const snapshot = await warehouseSnapshot(storyId);
    const first = await pasteVisualImageForStory({
      storyId,
      userId: USER_ID,
      pasteId: "paste-a",
      snapshot,
      targetFrame: 80,
      targetLayer: 2,
    });
    const version = await persistedVersion(storyId);
    const conflicting = await pasteVisualImageForStory({
      storyId,
      userId: USER_ID,
      pasteId: "paste-a",
      snapshot,
      targetFrame: 120,
      targetLayer: 3,
    });
    expect(conflicting).toMatchObject({ status: "error", errorKind: "invalid" });
    expect(await persistedVersion(storyId)).toBe(version);
    expect((await persistedPlacements(storyId))[`image:${first.clipId}`]).toBe(
      "track-2@80+3"
    );
  });

  it("deletes only the selected reference and keeps its warehouse image", async () => {
    const storyId = await seedStory();
    const snapshot = await warehouseSnapshot(storyId);
    const pasted = await pasteVisualImageForStory({
      storyId,
      userId: USER_ID,
      pasteId: "paste-delete",
      snapshot,
      targetFrame: 80,
      targetLayer: 2,
    });
    if (pasted.status !== "ok" || !pasted.clipId) return;
    const row = await getStoryTimeline(storyId, USER_ID);
    const owner = (row?.items as VisualEditDocument["items"]).find(item =>
      item.imageClips?.some(clip => clip.id === pasted.clipId)
    );
    const deleted = await deleteVisualObjectForStory({
      storyId,
      userId: USER_ID,
      object: {
        type: "image-clip",
        ownerStableShotId: owner!.stableShotId,
        clipId: pasted.clipId,
      },
    });
    expect(deleted).toMatchObject({ status: "ok", changed: true });
    expect((await persistedPlacements(storyId))[`image:${pasted.clipId}`]).toBeUndefined();
    await expect(getGeneratedImageById(snapshot.imageId)).resolves.toMatchObject({
      id: snapshot.imageId,
      storyId,
    });
  });

  it("rejects a clipboard snapshot from another Story", async () => {
    const storyId = await seedStory();
    const snapshot = await warehouseSnapshot(storyId);
    const result = await pasteVisualImageForStory({
      storyId,
      userId: USER_ID,
      pasteId: "paste-cross-story",
      snapshot: { ...snapshot, sourceStoryId: storyId + 1 },
      targetFrame: 80,
      targetLayer: 2,
    });
    expect(result).toMatchObject({ status: "error", errorKind: "invalid" });
  });
});

describe("durable extracted-frame placement", () => {
  beforeEach(() => resetMemoryStateForTesting());

  it("inserts a visible adjacent layer and the one-frame image in one write", async () => {
    const storyId = await seedStory();
    const before = await getStoryTimeline(storyId, USER_ID);
    await updateStoryTimeline({
      storyId,
      userId: USER_ID,
      expectedVersion: before!.version,
      items: before!.items,
      overlays: before!.overlays,
      visualLayerState: { count: 2, hidden: [1] },
    });
    const version = await persistedVersion(storyId);

    const result = await placeExtractedFrameForStory({
      storyId,
      userId: USER_ID,
      clipId: "receipt-frame-a",
      imageId: 9001,
      imageUrl: "/api/images/frame-a.png",
      label: "抽帧 500ms",
      timelineFrame: 15,
      operationLayer: 0,
    });

    expect(result).toMatchObject({
      status: "ok",
      changed: true,
      timelineVersion: version + 1,
      clipId: "receipt-frame-a",
      targetLayer: 1,
    });
    const saved = await getStoryTimeline(storyId, USER_ID);
    expect(saved?.visualLayerState).toEqual({ count: 4, hidden: [2] });
    const document = {
      items: saved!.items as VisualEditDocument["items"],
      overlays: saved!.overlays as VisualEditDocument["overlays"],
    };
    expect(projectVisualClips(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "image:receipt-frame-a",
          trackId: "track-1",
          startFrame: 15,
          durationFrames: 1,
        }),
        expect.objectContaining({ id: "overlay:ov-1", trackId: "track-2" }),
      ])
    );
  });

  it("treats a placed receipt clip as replay even after the user moves it", async () => {
    const storyId = await seedStory();
    const input = {
      storyId,
      userId: USER_ID,
      clipId: "receipt-frame-b",
      imageId: 9002,
      imageUrl: "/api/images/frame-b.png",
      label: "抽帧 1000ms",
      timelineFrame: 30,
      operationLayer: 0,
    };
    await placeExtractedFrameForStory(input);
    await moveVisualClipForStory({
      storyId,
      userId: USER_ID,
      clipId: "image:receipt-frame-b",
      toTrackId: "track-3",
      toStartFrame: 75,
    });
    const versionAfterMove = await persistedVersion(storyId);

    const replay = await placeExtractedFrameForStory(input);

    expect(replay).toMatchObject({
      status: "ok",
      changed: false,
      timelineVersion: versionAfterMove,
      targetLayer: 3,
    });
    expect((await persistedPlacements(storyId))["image:receipt-frame-b"]).toBe(
      "track-3@75+1"
    );
  });
});

/** 每个镜头的绝对起点与时长，用来断言「只有它变了」。 */
async function persistedShotSpans(storyId: number) {
  const row = await getStoryTimeline(storyId, USER_ID);
  const items = (row?.items ?? []) as { stableShotId: string }[];
  const rows = buildTimelineLayout(items as never);
  return Object.fromEntries(
    rows.map(layoutRow => [
      layoutRow.item.stableShotId,
      `${layoutRow.startFrame}+${layoutRow.durationFrames}`,
    ])
  );
}

/** 两个镜头都带显式绝对起点——多轨模型落地后的真实形状。 */
async function seedStoryWithExplicitPositions() {
  const story = await createStory({
    userId: USER_ID,
    title: "显式位置",
    body: {
      shots: [
        { shotNo: 1, stableShotId: "sh-01" },
        { shotNo: 2, stableShotId: "sh-02" },
      ],
    },
  });
  await updateStoryTimeline({
    storyId: story.id,
    userId: USER_ID,
    expectedVersion: 0,
    items: [
      {
        stableShotId: "sh-01",
        included: true,
        position: 0,
        plannedDurationMs: 4000,
        durationFrames: 120,
        timelineStartFrame: 0,
        visualLayer: 0,
        transform: TRANSFORM,
      },
      {
        stableShotId: "sh-02",
        included: true,
        position: 1,
        plannedDurationMs: 4000,
        durationFrames: 120,
        timelineStartFrame: 120,
        visualLayer: 0,
        transform: TRANSFORM,
      },
    ],
  });
  return story.id;
}

/** 整条片长 = 最大结束时间，不是顺序上最后一镜的结尾。 */
function timelineEndFrame(spans: Record<string, string>): number {
  return Math.max(
    0,
    ...Object.values(spans).map(span => {
      const [start, duration] = span.split("+").map(Number);
      return start + duration;
    })
  );
}

describe("planner 系列命令（U3）", () => {
  beforeEach(() => resetMemoryStateForTesting());

  it("单镜移动只改那一个镜头的起点，版本只 +1", async () => {
    const storyId = await seedStory();
    const before = await persistedShotSpans(storyId);
    const version = await persistedVersion(storyId);

    const result = await moveShotSingleForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-02",
      deltaFrames: 30,
      snapThresholdFrames: 0,
    });

    expect(result.status).toBe("ok");
    expect(await persistedVersion(storyId)).toBe(version + 1);
    const after = await persistedShotSpans(storyId);
    expect(after["sh-01"]).toBe(before["sh-01"]);
    expect(after["sh-02"]).not.toBe(before["sh-02"]);
  });

  it("客户端一个派生状态都不用传：只给镜头 id 和帧差就能落库", async () => {
    // 这条守的是 U3 的核心断言——rows 与镜头素材信息全由服务端自己算。
    // 参数里出现 items / rows / expectedVersion 就说明收敛没做干净。
    const storyId = await seedStory();
    const result = await moveShotSingleForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-02",
      deltaFrames: 12,
    });
    expect(result.status).toBe("ok");
  });

  it("方向整组移动不牵连上层图片的绝对位置", async () => {
    const storyId = await seedStory();
    const before = await persistedPlacements(storyId);

    const result = await moveShotGroupForStory({
      storyId,
      userId: USER_ID,
      sourceShotId: "sh-01",
      direction: "right",
      deltaFrames: 24,
    });

    expect(result.status).toBe("ok");
    const after = await persistedPlacements(storyId);
    // 上层一帧图片各自持有绝对帧，底层镜头移动不得改写它们。
    expect(after["img-abs"]).toBe(before["img-abs"]);
  });

  it("打标返回锚点 id，取消打标能用它删掉", async () => {
    const storyId = await seedStory();

    const added = await addTimelineAnchorForStory({
      storyId,
      userId: USER_ID,
      timelineFrame: 10,
    });
    expect(added.status).toBe("ok");
    if (added.status !== "ok") return;
    expect(added.anchorId).toBeTruthy();

    const removed = await removeTimelineAnchorForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-01",
      anchorId: added.anchorId as string,
    });
    expect(removed.status).toBe("ok");
  });

  it("左右顺序反过来时没有接缝，取消吸附返回 invalid 而不是悄悄成功", async () => {
    // sh-01 结束正好接 sh-02 开始，(sh-01, sh-02) 是真实接缝；
    // 反过来问 (sh-02, sh-01) 就不是——命令必须拒绝，而不是当成一次空操作。
    const storyId = await seedStory();
    const version = await persistedVersion(storyId);

    const result = await magnetDetachForStory({
      storyId,
      userId: USER_ID,
      leftStableShotId: "sh-02",
      rightStableShotId: "sh-01",
    });

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.errorKind).toBe("invalid");
    expect(result.error).toContain("吸附");
    expect(await persistedVersion(storyId)).toBe(version);
  });

  it("镜头不在时间轴上时，修剪返回可见错误且不写库", async () => {
    const storyId = await seedStory();
    const version = await persistedVersion(storyId);

    const result = await trimShotForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-does-not-exist",
      edge: "end",
      requestedBoundaryFrame: 60,
    });

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.errorKind).toBe("invalid");
    expect(await persistedVersion(storyId)).toBe(version);
  });

  it("滚动剪辑原子改动接缝两侧，总结束时间不变（账本 anchors 第 9 条）", async () => {
    // 必须用「两侧都带显式 timelineStartFrame」的真实形状。
    // 右镜是隐式位置时，planTimelineRollingTrim 会把总片长砍掉一截——那是
    // 一个既有 bug（2026-08-23 发现，已单独立项），不在本轮写入路径收敛范围内。
    const storyId = await seedStoryWithExplicitPositions();
    const before = await persistedShotSpans(storyId);
    const totalBefore = timelineEndFrame(before);

    const result = await rollingTrimForStory({
      storyId,
      userId: USER_ID,
      leftStableShotId: "sh-01",
      rightStableShotId: "sh-02",
      requestedBoundaryFrame: 90,
    });

    expect(result.status).toBe("ok");
    const after = await persistedShotSpans(storyId);
    // 接缝滚动：左镜变短、右镜提前开始，两侧必须一起变。
    expect(after["sh-01"]).not.toBe(before["sh-01"]);
    expect(after["sh-02"]).not.toBe(before["sh-02"]);
    // 而整条片长不能因为滚动接缝而改变。
    expect(timelineEndFrame(after)).toBe(totalBefore);
  });

  it("故事不存在时返回可见错误，不抛异常", async () => {
    const result = await moveShotSingleForStory({
      storyId: 999999,
      userId: USER_ID,
      stableShotId: "sh-01",
      deltaFrames: 1,
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.errorKind).toBe("invalid");
  });
});

describe("单镜移动的换层与 overlay 迁移（U3）", () => {
  beforeEach(() => resetMemoryStateForTesting());

  it("斜向拖动一次提交：位置与视觉层一起变，版本只 +1", async () => {
    const storyId = await seedStoryWithExplicitPositions();
    const version = await persistedVersion(storyId);

    const result = await moveShotSingleForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-02",
      deltaFrames: 30,
      snapThresholdFrames: 0,
      toVisualLayer: 2,
    });

    expect(result.status).toBe("ok");
    expect(await persistedVersion(storyId)).toBe(version + 1);
    const row = await getStoryTimeline(storyId, USER_ID);
    const moved = (row?.items as { stableShotId: string; visualLayer?: number }[]).find(
      item => item.stableShotId === "sh-02"
    );
    expect(moved?.visualLayer).toBe(2);
  });

  it("帧差为 0 也能只换层，不被当成空操作跳过", async () => {
    const storyId = await seedStoryWithExplicitPositions();
    const version = await persistedVersion(storyId);

    const result = await moveShotSingleForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-02",
      deltaFrames: 0,
      toVisualLayer: 3,
    });

    expect(result.status).toBe("ok");
    expect(await persistedVersion(storyId)).toBe(version + 1);
    const row = await getStoryTimeline(storyId, USER_ID);
    const moved = (row?.items as { stableShotId: string; visualLayer?: number }[]).find(
      item => item.stableShotId === "sh-02"
    );
    expect(moved?.visualLayer).toBe(3);
  });

  it("移动带遗留 overlay 的镜头，会在同一次写入里迁移掉那条 overlay", async () => {
    // 账本 extracted-frame-overlay-video 第 15 条：遗留 overlay 在首次移动或
    // 换层时迁移为普通上层镜头并移除专用覆盖记录。
    const storyId = await seedStory();
    const before = await getStoryTimeline(storyId, USER_ID);
    expect((before?.overlays as unknown[])?.length).toBe(1);

    const result = await moveShotSingleForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-01",
      deltaFrames: 12,
      snapThresholdFrames: 0,
    });

    expect(result.status).toBe("ok");
    const after = await getStoryTimeline(storyId, USER_ID);
    expect((after?.overlays as unknown[])?.length).toBe(0);
    const migrated = (after?.items as { stableShotId: string; visualLayer?: number }[]).find(
      item => item.stableShotId === "sh-01"
    );
    // 不给层号会掉回底层把画面盖掉，所以迁移默认落在第 1 层。
    expect(migrated?.visualLayer).toBe(1);
  });

  it("镜头不在时间轴上时返回 invalid，不写库", async () => {
    const storyId = await seedStoryWithExplicitPositions();
    const version = await persistedVersion(storyId);

    const result = await moveShotSingleForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-nope",
      deltaFrames: 10,
      toVisualLayer: 1,
    });

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.errorKind).toBe("invalid");
    expect(await persistedVersion(storyId)).toBe(version);
  });
});

describe("图层管理命令（U4）", () => {
  beforeEach(() => resetMemoryStateForTesting());

  async function layerState(storyId: number) {
    const row = await getStoryTimeline(storyId, USER_ID);
    return row?.visualLayerState as { count: number; hidden: number[] } | undefined;
  }

  it("隐藏一层不改变其它层任何素材的绝对时间（账本第 29 条）", async () => {
    const storyId = await seedStory();
    const before = await persistedPlacements(storyId);

    const result = await applyVisualLayerActionForStory({
      storyId,
      userId: USER_ID,
      action: { kind: "toggle-hidden", layer: 1 },
    });

    expect(result.status).toBe("ok");
    expect((await layerState(storyId))?.hidden).toContain(1);
    // 隐藏只影响可见性解析，不得挪动任何素材。
    expect(await persistedPlacements(storyId)).toEqual(before);
  });

  it("再切一次显隐会取消隐藏", async () => {
    const storyId = await seedStory();
    await applyVisualLayerActionForStory({
      storyId,
      userId: USER_ID,
      action: { kind: "toggle-hidden", layer: 1 },
    });
    await applyVisualLayerActionForStory({
      storyId,
      userId: USER_ID,
      action: { kind: "toggle-hidden", layer: 1 },
    });
    expect((await layerState(storyId))?.hidden ?? []).not.toContain(1);
  });

  it("插入一层把层内全部素材一起重编号，版本只 +1", async () => {
    const storyId = await seedStory();
    const version = await persistedVersion(storyId);
    const before = await persistedPlacements(storyId);

    const result = await applyVisualLayerActionForStory({
      storyId,
      userId: USER_ID,
      action: { kind: "insert", at: 1 },
    });

    expect(result.status).toBe("ok");
    expect(await persistedVersion(storyId)).toBe(version + 1);
    // 层号变了，但每个 clip 的绝对帧和时长一个都不能动。
    const after = await persistedPlacements(storyId);
    for (const [clipId, span] of Object.entries(before)) {
      const [, startAndDuration] = span.split("@");
      const [, afterStartAndDuration] = (after[clipId] ?? "").split("@");
      expect(afterStartAndDuration).toBe(startAndDuration);
    }
  });

  it("整层上下移动后素材仍在同一绝对帧上", async () => {
    const storyId = await seedStory();
    const before = await persistedPlacements(storyId);

    const result = await applyVisualLayerActionForStory({
      storyId,
      userId: USER_ID,
      action: { kind: "move", from: 1, to: 2 },
    });

    expect(result.status).toBe("ok");
    const after = await persistedPlacements(storyId);
    for (const [clipId, span] of Object.entries(before)) {
      expect((after[clipId] ?? "").split("@")[1]).toBe(span.split("@")[1]);
    }
  });

  it("故事没有时间线时返回 invalid，不抛异常", async () => {
    const result = await applyVisualLayerActionForStory({
      storyId: 999999,
      userId: USER_ID,
      action: { kind: "insert", at: 0 },
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.errorKind).toBe("invalid");
  });
});

/** 带一个镜头内部视频片段，且开着「用片段替代主画面」。 */
async function seedStoryWithInnerVideoClip() {
  const story = await createStory({
    userId: USER_ID,
    title: "内部片段",
    body: { shots: [{ shotNo: 1, stableShotId: "sh-01" }] },
  });
  await updateStoryTimeline({
    storyId: story.id,
    userId: USER_ID,
    expectedVersion: 0,
    items: [
      {
        stableShotId: "sh-01",
        included: true,
        position: 0,
        plannedDurationMs: 4000,
        durationFrames: 120,
        timelineStartFrame: 0,
        visualLayer: 0,
        transform: TRANSFORM,
        visualClipsReplacePrimary: true,
        visualClips: [
          {
            id: "inner-1",
            takeId: 11,
            rangeId: 1,
            sourceStableShotId: "sh-01",
            videoUrl: "/inner.mp4",
            label: "片段",
            sourceStartSec: 0,
            sourceEndSec: 2,
            offsetMs: 0,
            durationMs: 2000,
          },
        ],
      },
    ],
  });
  return story.id;
}

describe("窄补丁命令（U6）", () => {
  beforeEach(() => resetMemoryStateForTesting());

  async function items(storyId: number) {
    const row = await getStoryTimeline(storyId, USER_ID);
    return (row?.items ?? []) as {
      stableShotId: string;
      included?: boolean;
      position: number;
      visualClips?: { id: string }[];
      visualClipsReplacePrimary?: boolean;
    }[];
  }

  it("移出时间线只改那一个镜头的 included，位置一个不动", async () => {
    const storyId = await seedStory();
    const before = await persistedPlacements(storyId);

    const result = await setShotIncludedForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-02",
      included: false,
    });

    expect(result.status).toBe("ok");
    const after = await items(storyId);
    expect(after.find(i => i.stableShotId === "sh-02")?.included).toBe(false);
    expect(after.find(i => i.stableShotId === "sh-01")?.included).toBe(true);
    expect(await persistedPlacements(storyId)).toEqual(before);
  });

  it("镜头不在时间线上时返回 invalid", async () => {
    const storyId = await seedStory();
    const result = await setShotIncludedForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-nope",
      included: false,
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.errorKind).toBe("invalid");
  });

  it("相邻交换后 position 连续无空洞", async () => {
    const storyId = await seedStory();

    const result = await moveShotOrderForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-02",
      direction: -1,
    });

    expect(result.status).toBe("ok");
    const after = await items(storyId);
    expect(after.find(i => i.stableShotId === "sh-02")?.position).toBe(0);
    expect(after.find(i => i.stableShotId === "sh-01")?.position).toBe(1);
    expect([...after].map(i => i.position).sort()).toEqual([0, 1]);
  });

  it("已经到头时拒绝并说明原因，不写库", async () => {
    const storyId = await seedStory();
    const version = await persistedVersion(storyId);

    const result = await moveShotOrderForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-01",
      direction: -1,
    });

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error).toContain("到头");
    expect(await persistedVersion(storyId)).toBe(version);
  });

  it("源与目标相同时返回未改变，不写库不推高版本", async () => {
    const storyId = await seedStory();
    const version = await persistedVersion(storyId);

    const result = await reorderShotToTargetForStory({
      storyId,
      userId: USER_ID,
      sourceShotId: "sh-01",
      targetShotId: "sh-01",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.changed).toBe(false);
    expect(await persistedVersion(storyId)).toBe(version);
  });

  it("恢复全部镜头后 included 全为真且顺序连续", async () => {
    const storyId = await seedStory();
    await setShotIncludedForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-02",
      included: false,
    });

    const result = await includeAllShotsForStory({ storyId, userId: USER_ID });

    expect(result.status).toBe("ok");
    const after = await items(storyId);
    expect(after.every(i => i.included)).toBe(true);
    expect(after.map(i => i.position).sort()).toEqual([0, 1]);
  });

  it("移除最后一个内部片段时，用片段替代主画面必须回落", async () => {
    const storyId = await seedStoryWithInnerVideoClip();

    const result = await removeInnerVideoClipForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-01",
      clipId: "inner-1",
    });

    expect(result.status).toBe("ok");
    const after = await items(storyId);
    const updated = after.find(i => i.stableShotId === "sh-01");
    expect(updated?.visualClips ?? []).toHaveLength(0);
    // 片段没了还留着「用片段替代主画面」，镜头会变成一块空白。
    expect(updated?.visualClipsReplacePrimary).toBeFalsy();
  });

  it("找不到片段时返回可见错误，不静默成功", async () => {
    const storyId = await seedStory();
    const result = await removeInnerVideoClipForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-01",
      clipId: "no-such-clip",
    });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error).toContain("找不到");
  });
});

describe("时长与图片构图命令（U6）", () => {
  beforeEach(() => resetMemoryStateForTesting());

  it("改时长只动那一个镜头，别的镜头一个不变", async () => {
    const storyId = await seedStoryWithExplicitPositions();
    const before = await getStoryTimeline(storyId, USER_ID);
    const otherBefore = (before?.items as { stableShotId: string }[]).find(
      i => i.stableShotId === "sh-01"
    );

    const result = await setShotDurationForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-02",
      durationMs: 6000,
    });

    expect(result.status).toBe("ok");
    const after = await getStoryTimeline(storyId, USER_ID);
    const rows = after?.items as {
      stableShotId: string;
      plannedDurationMs: number;
    }[];
    expect(rows.find(i => i.stableShotId === "sh-02")?.plannedDurationMs).toBe(
      6000
    );
    expect(rows.find(i => i.stableShotId === "sh-01")).toEqual(otherBefore);
  });

  it("文字层传 null 时整条删掉，不留空对象", async () => {
    const storyId = await seedStoryWithExplicitPositions();
    const transform = {
      cropX: 0,
      cropY: 0,
      cropWidth: 1,
      cropHeight: 1,
      zoom: 1,
      panX: 0,
      panY: 0,
    };

    await patchImageTransformForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-01",
      imageId: 1702,
      transform,
      textOverlay: {
        text: "标题",
        anchor: "center",
        sizeScale: 1,
        color: "#fff",
      } as never,
    });
    await patchImageTransformForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-01",
      imageId: 1702,
      transform,
      textOverlay: null,
    });

    const row = await getStoryTimeline(storyId, USER_ID);
    const shot = (row?.items as {
      stableShotId: string;
      imageTextOverlays?: Record<string, unknown>;
      imageTransforms?: Record<string, unknown>;
    }[]).find(i => i.stableShotId === "sh-01");
    // 留个空对象会让导出以为还有文字要画。
    expect(shot?.imageTextOverlays).toBeUndefined();
    expect(shot?.imageTransforms?.["1702"]).toBeTruthy();
  });

  it("镜头不在时间线上时两条命令都返回 invalid", async () => {
    const storyId = await seedStoryWithExplicitPositions();
    const duration = await setShotDurationForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-nope",
      durationMs: 3000,
    });
    expect(duration.status).toBe("error");
    if (duration.status === "error") {
      expect(duration.errorKind).toBe("invalid");
    }
  });
});

describe("服务端撤销日志（U5）", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
    clearVisualEditUndoForTesting();
  });

  /** 整份文档快照，用来断言「逐字段回到命令前」。 */
  async function documentSnapshot(storyId: number) {
    const row = await getStoryTimeline(storyId, USER_ID);
    return JSON.stringify({
      items: row?.items,
      overlays: row?.overlays,
      visualLayerState: row?.visualLayerState,
    });
  }

  it("移动之后撤销，文档逐字段回到移动前", async () => {
    const storyId = await seedStory();
    const before = await documentSnapshot(storyId);

    await moveShotSingleForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-02",
      deltaFrames: 30,
      snapThresholdFrames: 0,
    });
    expect(await documentSnapshot(storyId)).not.toBe(before);

    const undone = await undoVisualEditForStory({ storyId, userId: USER_ID });
    expect(undone.status).toBe("ok");
    expect(await documentSnapshot(storyId)).toBe(before);
  });

  it("连续三次命令后连撤三次，逐步回到初始状态", async () => {
    const storyId = await seedStory();
    const snapshots = [await documentSnapshot(storyId)];

    await moveShotSingleForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-02",
      deltaFrames: 30,
      snapThresholdFrames: 0,
    });
    snapshots.push(await documentSnapshot(storyId));

    await applyVisualLayerActionForStory({
      storyId,
      userId: USER_ID,
      action: { kind: "toggle-hidden", layer: 1 },
    });
    snapshots.push(await documentSnapshot(storyId));

    await setShotIncludedForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-01",
      included: false,
    });

    // 倒着撤，每一步都要落在对应的历史快照上。
    for (const expected of [...snapshots].reverse()) {
      const undone = await undoVisualEditForStory({ storyId, userId: USER_ID });
      expect(undone.status).toBe("ok");
      expect(await documentSnapshot(storyId)).toBe(expected);
    }
  });

  it("图层显隐和素材一起还原：一次撤销全部回来（账本第 30 条）", async () => {
    const storyId = await seedStory();
    const before = await documentSnapshot(storyId);

    // 一次图层命令同时改了层状态与层内素材的层号。
    await applyVisualLayerActionForStory({
      storyId,
      userId: USER_ID,
      action: { kind: "insert", at: 1 },
    });

    const undone = await undoVisualEditForStory({ storyId, userId: USER_ID });
    expect(undone.status).toBe("ok");
    // 一次 Cmd+Z 不能只还原一半。
    expect(await documentSnapshot(storyId)).toBe(before);
  });

  it("没有产生实际改动的命令不占撤销栈", async () => {
    const storyId = await seedStory();

    // 源与目标相同，命令返回 changed:false，不该记一格。
    await reorderShotToTargetForStory({
      storyId,
      userId: USER_ID,
      sourceShotId: "sh-01",
      targetShotId: "sh-01",
    });

    const undone = await undoVisualEditForStory({ storyId, userId: USER_ID });
    expect(undone.status).toBe("error");
    if (undone.status !== "error") return;
    expect(undone.error).toContain("没有可撤销");
  });

  it("失败的命令不进撤销栈", async () => {
    const storyId = await seedStory();

    await moveShotOrderForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-01",
      direction: -1,
    });

    const undone = await undoVisualEditForStory({ storyId, userId: USER_ID });
    expect(undone.status).toBe("error");
  });

  it("撤销本身不进撤销栈，不会在两个状态之间来回跳", async () => {
    const storyId = await seedStory();
    const before = await documentSnapshot(storyId);

    await moveShotSingleForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-02",
      deltaFrames: 30,
      snapThresholdFrames: 0,
    });
    await undoVisualEditForStory({ storyId, userId: USER_ID });

    const second = await undoVisualEditForStory({ storyId, userId: USER_ID });
    expect(second.status).toBe("error");
    expect(await documentSnapshot(storyId)).toBe(before);
  });

  it("撤销栈按用户隔离，别人的操作撤不到", async () => {
    const storyId = await seedStory();
    await moveShotSingleForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-02",
      deltaFrames: 30,
      snapThresholdFrames: 0,
    });

    const other = await undoVisualEditForStory({
      storyId,
      userId: USER_ID + 999,
    });
    expect(other.status).toBe("error");
  });

  it("撤销也是一次写入，版本继续前进而不是回退", async () => {
    const storyId = await seedStory();
    await moveShotSingleForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-02",
      deltaFrames: 30,
      snapThresholdFrames: 0,
    });
    const afterMove = await persistedVersion(storyId);

    await undoVisualEditForStory({ storyId, userId: USER_ID });
    expect(await persistedVersion(storyId)).toBe(afterMove + 1);
  });
});

describe("撤销失败后不吞掉那一格（U5）", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
    clearVisualEditUndoForTesting();
  });

  it("写入失败时把日志项放回去，下次还能撤", async () => {
    const storyId = await seedStory();
    const before = await getStoryTimeline(storyId, USER_ID);

    await moveShotSingleForStory({
      storyId,
      userId: USER_ID,
      stableShotId: "sh-02",
      deltaFrames: 30,
      snapThresholdFrames: 0,
    });

    // 让这一次撤销必定写失败：故事查得到、但写入时版本对不上。
    const failing = vi
      .spyOn(dbModule, "updateStoryTimeline")
      .mockRejectedValue(new Error("时间轴版本已更新"));
    const failed = await undoVisualEditForStory({ storyId, userId: USER_ID });
    expect(failed.status).toBe("error");
    failing.mockRestore();

    // 那一格必须还在，否则用户永远撤不回这一步。
    const retried = await undoVisualEditForStory({ storyId, userId: USER_ID });
    expect(retried.status).toBe("ok");
    const after = await getStoryTimeline(storyId, USER_ID);
    expect(JSON.stringify(after?.items)).toBe(JSON.stringify(before?.items));
  });
});

describe("播放头解析成「这里是哪一镜」", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
    clearVisualEditUndoForTesting();
  });

  // 「播放头那一帧是哪个镜头」的判定本身住在 shared/timelineCommands 的
  // resolveTimelineFrameSource 里（预览、剪辑行、导出共用同一个入口）。
  // 这里只断言本模块的接线契约：解析不出来时不硬猜、已有选择不被覆盖。
  // 有素材时的 happy path 用主仓 3000 的真实故事验收，夹具造不出
  // 「当前图片」那个状态——它由真实生成流程产生，硬造只会测到假东西。

  it("播放头落在空档时如实返回 null，不硬猜最近的一镜", async () => {
    const storyId = await seedStoryWithExplicitPositions();
    const at = await resolveShotAtPlayhead({
      storyId,
      userId: USER_ID,
      playheadMs: 999_000,
    });
    expect(at).toBeNull();
  });

  it("已经显式选中素材时不覆盖用户的选择", async () => {
    const storyId = await seedStoryWithExplicitPositions();
    const kept = await withPlayheadShot(storyId, USER_ID, 6000, {
      stableShotId: "sh-01",
    });
    expect(kept.stableShotId).toBe("sh-01");
  });

  it("解析不出可见素材时，选择上下文原样返回，不塞一个猜的镜头", async () => {
    const storyId = await seedStoryWithExplicitPositions();
    const untouched = await withPlayheadShot(storyId, USER_ID, 6000, {
      stableShotId: null,
    });
    expect(untouched.stableShotId).toBeNull();
  });
});
