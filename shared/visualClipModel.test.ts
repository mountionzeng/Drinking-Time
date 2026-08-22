import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  DEFAULT_TIMELINE_VIDEO_EFFECTS,
  type StoryTimelineItem,
  type StoryTimelineOverlay,
} from "./storyMaterial";
import {
  materializeAbsolutePlacements,
  moveVisualClip,
  projectVisualClips,
  visualTrackId,
  type VisualClip,
  type VisualEditDocument,
} from "./visualClipModel";

function shot(
  stableShotId: string,
  position: number,
  overrides: Partial<StoryTimelineItem> = {}
): StoryTimelineItem {
  return {
    stableShotId,
    included: true,
    position,
    plannedDurationMs: 4000,
    durationFrames: 120,
    transform: DEFAULT_TIMELINE_TRANSFORM,
    ...overrides,
  };
}

/** 底层视频 + 两张独立图片（一张只有旧的相对坐标）+ 一个遗留 overlay。 */
function fixture(): VisualEditDocument {
  return {
    items: [
      shot("sh-01", 0, {
        timelineStartFrame: 0,
        visualLayer: 0,
        primaryVideoEdit: {
          takeId: 9,
          sourceStartSec: 0,
          sourceEndSec: 4,
          effects: DEFAULT_TIMELINE_VIDEO_EFFECTS,
        },
        imageClips: [
          {
            // 旧数据：只有相对 owner 的 offsetFrames。
            id: "img-legacy",
            imageId: 1702,
            imageUrl: "https://example.test/1702.png",
            label: "旧图",
            offsetFrames: 30,
            durationFrames: 1,
            visualLayer: 1,
          },
          {
            id: "img-abs",
            imageId: 1708,
            imageUrl: "https://example.test/1708.png",
            label: "新图",
            offsetFrames: 0,
            timelineStartFrame: 107,
            durationFrames: 1,
            visualLayer: 1,
          },
        ],
      }),
      // 没有 timelineStartFrame：位置由前一个镜头的结尾推出来。
      shot("sh-02", 1, { visualLayer: 0 }),
    ],
    overlays: [
      {
        id: "ov-1",
        kind: "generated-video",
        takeId: 5,
        sourceStableShotId: "sh-01",
        videoUrl: "https://example.test/ov.mp4",
        startFrame: 71,
        targetEndFrame: 101,
        mediaEndFrame: 101,
        endFrame: 101,
        stackOrder: 3,
        leftImageId: 1702,
        rightImageId: 1708,
        transform: DEFAULT_TIMELINE_TRANSFORM,
      } satisfies StoryTimelineOverlay,
    ],
    visualLayerState: { count: 3, hidden: [] },
  };
}

function placements(doc: VisualEditDocument): Record<string, string> {
  return Object.fromEntries(
    projectVisualClips(doc).map(clip => [
      clip.id,
      `${clip.trackId}@${clip.startFrame}+${clip.durationFrames}`,
    ])
  );
}

function clipById(doc: VisualEditDocument, id: string): VisualClip {
  const clip = projectVisualClips(doc).find(candidate => candidate.id === id);
  if (!clip) throw new Error(`missing clip ${id}`);
  return clip;
}

function moveOk(
  doc: VisualEditDocument,
  clipId: string,
  toTrackId: string,
  toStartFrame: number
) {
  const result = moveVisualClip(doc, { clipId, toTrackId, toStartFrame });
  if (result.status !== "ok") {
    throw new Error(`move failed: ${result.error} ${result.message}`);
  }
  return result;
}

describe("projectVisualClips", () => {
  it("把四种历史形状投影成同一种绝对帧 clip", () => {
    expect(placements(fixture())).toEqual({
      "shot:sh-01": "track-0@0+120",
      "shot:sh-02": "track-0@120+120",
      // 旧图仍然按 owner 起点 + 30 解释
      "image:img-legacy": "track-1@30+1",
      "image:img-abs": "track-1@107+1",
      "overlay:ov-1": "track-1@71+30",
    });
  });
});

describe("moveVisualClip", () => {
  it("图片左右移动只改自己的起点，并保持一帧结构时长", () => {
    const moved = moveOk(fixture(), "image:img-abs", visualTrackId(1), 200);
    expect(clipById(moved.document, "image:img-abs")).toMatchObject({
      trackId: "track-1",
      startFrame: 200,
      durationFrames: 1,
    });
    expect(moved.changed).toBe(true);
  });

  it("图片上下换轨不改起点", () => {
    const moved = moveOk(fixture(), "image:img-abs", visualTrackId(2), 107);
    expect(clipById(moved.document, "image:img-abs")).toMatchObject({
      trackId: "track-2",
      startFrame: 107,
    });
  });

  it("一次斜向移动同时改变位置和轨道", () => {
    const moved = moveOk(fixture(), "image:img-legacy", visualTrackId(2), 240);
    expect(clipById(moved.document, "image:img-legacy")).toMatchObject({
      trackId: "track-2",
      startFrame: 240,
    });
  });

  it("视频左右移动同样只改自己", () => {
    const before = placements(fixture());
    const moved = moveOk(fixture(), "overlay:ov-1", visualTrackId(1), 300);
    const after = placements(moved.document);
    expect(after["overlay:ov-1"]).toBe("track-1@300+30");
    for (const id of Object.keys(before)) {
      if (id === "overlay:ov-1") continue;
      expect(after[id]).toBe(before[id]);
    }
  });

  it("移动底层视频不改变任何其它 clip 的绝对位置", () => {
    const before = placements(fixture());
    const moved = moveOk(fixture(), "shot:sh-01", visualTrackId(0), 60);
    const after = placements(moved.document);
    expect(after["shot:sh-01"]).toBe("track-0@60+120");
    // 只有底层视频动了：旧的相对坐标图片、绝对坐标图片、overlay、后一个镜头全都不动。
    expect(after["image:img-legacy"]).toBe(before["image:img-legacy"]);
    expect(after["image:img-abs"]).toBe(before["image:img-abs"]);
    expect(after["overlay:ov-1"]).toBe(before["overlay:ov-1"]);
    expect(after["shot:sh-02"]).toBe(before["shot:sh-02"]);
  });

  it("移动镜头会带走它自己的内部片段", () => {
    const doc = fixture();
    doc.items[1] = {
      ...doc.items[1],
      visualClips: [
        {
          id: "vc-1",
          takeId: 7,
          rangeId: 3,
          sourceStableShotId: "sh-02",
          videoUrl: "https://example.test/vc.mp4",
          label: "附加片段",
          sourceStartSec: 0,
          sourceEndSec: 1,
          offsetMs: 1000,
          durationMs: 1000,
          visualLayer: 0,
        },
      ],
    };
    expect(placements(doc)["video:vc-1"]).toBe("track-0@150+30");
    const moved = moveOk(doc, "shot:sh-02", visualTrackId(0), 200);
    expect(placements(moved.document)["video:vc-1"]).toBe("track-0@230+30");
  });

  it("同一次移动重复提交是幂等的", () => {
    const first = moveOk(fixture(), "image:img-abs", visualTrackId(2), 200);
    const second = moveOk(first.document, "image:img-abs", visualTrackId(2), 200);
    expect(second.changed).toBe(false);
    expect(placements(second.document)).toEqual(placements(first.document));
  });

  it("移动后的位置在重新读取时保持不变", () => {
    const moved = moveOk(fixture(), "image:img-legacy", visualTrackId(2), 240);
    // 模拟一次落库 + 重新读取：只有 JSON 能表达的东西留下来。
    const reloaded = JSON.parse(
      JSON.stringify(moved.document)
    ) as VisualEditDocument;
    expect(placements(reloaded)["image:img-legacy"]).toBe("track-2@240+1");
  });

  it("找不到 clip 时明确失败，不静默吞掉", () => {
    const result = moveVisualClip(fixture(), {
      clipId: "image:does-not-exist",
      toTrackId: visualTrackId(1),
      toStartFrame: 10,
    });
    expect(result).toMatchObject({ status: "error", error: "clip-not-found" });
  });

  it("非法轨道不猜层号", () => {
    const result = moveVisualClip(fixture(), {
      clipId: "image:img-abs",
      toTrackId: "layer1",
      toStartFrame: 10,
    });
    expect(result).toMatchObject({ status: "error", error: "invalid-track" });
  });

  it("负起点被拒绝", () => {
    const result = moveVisualClip(fixture(), {
      clipId: "image:img-abs",
      toTrackId: visualTrackId(1),
      toStartFrame: -1,
    });
    expect(result).toMatchObject({ status: "error", error: "invalid-start" });
  });
});

describe("materializeAbsolutePlacements", () => {
  it("把派生位置钉成绝对值，且不改变任何 clip 的可见位置", () => {
    const doc = fixture();
    const pinned = materializeAbsolutePlacements(doc);
    expect(placements(pinned)).toEqual(placements(doc));
    expect(pinned.items[1].timelineStartFrame).toBe(120);
    expect(pinned.items[0].imageClips?.[0].timelineStartFrame).toBe(30);
  });
});
