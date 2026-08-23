import { beforeEach, describe, expect, it } from "vitest";
import {
  createStory,
  getStoryTimeline,
  resetMemoryStateForTesting,
  updateStoryTimeline,
} from "../db";
import {
  insertVisualImageClipForStory,
  listVisualClips,
  moveVisualClipForStory,
} from "./visualClipEditing";
import { projectVisualClips, type VisualEditDocument } from "../../shared/visualClipModel";

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
    const listed = await listVisualClips(storyId, USER_ID);
    expect(listed.status).toBe("ok");
    const baseVersion =
      listed.status === "ok" ? listed.timelineVersion : Number.NaN;

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
    const listed = await listVisualClips(storyId, USER_ID);
    const baseVersion =
      listed.status === "ok" ? listed.timelineVersion : Number.NaN;

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
    for (const frame of [150, 150, 260]) {
      await insertVisualImageClipForStory({
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
    }
    const placements = await persistedPlacements(storyId);
    const matching = Object.keys(placements).filter(
      id => id === "image:img-extracted"
    );
    expect(matching).toHaveLength(1);
    expect(placements["image:img-extracted"]).toBe("track-1@260+1");
  });
});
