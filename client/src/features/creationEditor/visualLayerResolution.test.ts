import { describe, expect, it } from "vitest";

import type {
  StoryTimelineItem,
  StoryTimelineOverlay,
} from "@shared/storyMaterial";
import {
  resolveTimelineDocumentFrame,
  resolveTimelineImageClipAt,
  timelineImageBeatsVisualSource,
} from "@shared/timelineLayout";
import { moveTimelineVisualLayer } from "@shared/timelineVisualLayers";
import {
  buildStoryboardTimingRows,
  storyboardTimingWinnerAt,
} from "../storyAgent/storyboardTiming";
import {
  resolveTimelineFrameSource,
  timelineMagneticJoins,
} from "@shared/timelineCommands";
import { buildTimelineLayout } from "@shared/timelineLayout";

const transform = {
  cropX: 0,
  cropY: 0,
  cropWidth: 1,
  cropHeight: 1,
  zoom: 1,
  panX: 0,
  panY: 0,
};

function item(
  stableShotId: string,
  input: {
    position: number;
    startFrame: number;
    durationFrames: number;
    visualLayer?: number;
    stackOrder?: number;
    imageClips?: StoryTimelineItem["imageClips"];
    anchors?: StoryTimelineItem["anchors"];
  }
): StoryTimelineItem {
  return {
    stableShotId,
    included: true,
    position: input.position,
    plannedDurationMs: (input.durationFrames * 1000) / 30,
    durationFrames: input.durationFrames,
    timelineStartFrame: input.startFrame,
    stackOrder: input.stackOrder ?? input.position,
    visualLayer: input.visualLayer ?? 0,
    transform,
    ...(input.imageClips ? { imageClips: input.imageClips } : {}),
    ...(input.anchors ? { anchors: input.anchors } : {}),
  };
}

const shots = [
  { stableShotId: "base", shotNo: 1 },
  { stableShotId: "top", shotNo: 2 },
];
const shotIds = ["base", "top"];

/** 预览走的赢家（storyboardTiming）和导出走的赢家（timelineLayout）必须是同一镜。 */
function previewWinner(
  items: StoryTimelineItem[],
  frame: number,
  hidden: readonly number[] = []
): string | null {
  const rows = buildStoryboardTimingRows(shots, shotIds, items);
  return (
    storyboardTimingWinnerAt(rows, (frame * 1000) / 30, hidden)?.stableShotId ??
    null
  );
}

function exportWinner(
  items: StoryTimelineItem[],
  frame: number,
  hidden: readonly number[] = [],
  overlays: StoryTimelineOverlay[] = []
): string | null {
  const resolved = resolveTimelineDocumentFrame({
    items,
    overlays,
    hiddenVisualLayers: hidden,
    frame,
  });
  if (resolved.kind === "gap") return null;
  if (resolved.kind === "overlay") return `overlay:${resolved.overlay.id}`;
  return resolved.row.item.stableShotId;
}

describe("预览与导出共用同一套层级赢家规则", () => {
  /**
   * 这一条是这轮修复的根因回归：移动底层视频会把它的 stackOrder 抬到最高，
   * 而预览以前只比 stackOrder、不比 visualLayer，于是底层盖住上层，导出却仍按
   * 图层出片——同一份数据两个答案。
   */
  it("移动过的底层视频不会盖住上层视频", () => {
    const items = [
      item("base", {
        position: 0,
        startFrame: 0,
        durationFrames: 60,
        visualLayer: 0,
        // 刚被拖动过：stackOrder 是全场最高。
        stackOrder: 99,
      }),
      item("top", {
        position: 1,
        startFrame: 0,
        durationFrames: 60,
        visualLayer: 1,
        stackOrder: 1,
      }),
    ];
    expect(previewWinner(items, 30)).toBe("top");
    expect(exportWinner(items, 30)).toBe("top");
    expect(previewWinner(items, 30)).toBe(exportWinner(items, 30));
  });

  it("同层内仍然按 stackOrder 决定谁在上面", () => {
    const items = [
      item("base", {
        position: 0,
        startFrame: 0,
        durationFrames: 60,
        stackOrder: 99,
      }),
      item("top", {
        position: 1,
        startFrame: 0,
        durationFrames: 60,
        stackOrder: 1,
      }),
    ];
    expect(previewWinner(items, 30)).toBe("base");
    expect(exportWinner(items, 30)).toBe("base");
  });

  it("锚定镜头压过更高的图层，两条路径一致", () => {
    const items = [
      item("base", {
        position: 0,
        startFrame: 0,
        durationFrames: 60,
        visualLayer: 0,
        anchors: [
          {
            id: "a1",
            timelineFrame: 0,
            sourceType: "primary-video",
            sourceId: "take-1",
            sourceTimeSec: 0,
          },
        ],
      }),
      item("top", {
        position: 1,
        startFrame: 0,
        durationFrames: 60,
        visualLayer: 2,
      }),
    ];
    expect(previewWinner(items, 30)).toBe("base");
    expect(exportWinner(items, 30)).toBe("base");
  });

  it("隐藏上层后两条路径都回落到下层", () => {
    const items = [
      item("base", { position: 0, startFrame: 0, durationFrames: 60 }),
      item("top", {
        position: 1,
        startFrame: 0,
        durationFrames: 60,
        visualLayer: 1,
      }),
    ];
    expect(previewWinner(items, 30, [1])).toBe("base");
    expect(exportWinner(items, 30, [1])).toBe("base");
  });

  it("隐藏唯一覆盖这一帧的层就是空档，不残留上一镜", () => {
    const items = [
      item("top", {
        position: 0,
        startFrame: 0,
        durationFrames: 60,
        visualLayer: 1,
      }),
    ];
    expect(exportWinner(items, 30, [1])).toBe(null);
  });

  it("隐藏一层不会挪动其它层的隐式起点", () => {
    // 两镜都没有显式绝对帧，排版只能按游标依次累加。
    const implicit: StoryTimelineItem[] = [
      {
        stableShotId: "top",
        included: true,
        position: 0,
        plannedDurationMs: 2000,
        durationFrames: 60,
        visualLayer: 1,
        transform,
      },
      {
        stableShotId: "base",
        included: true,
        position: 1,
        plannedDurationMs: 2000,
        durationFrames: 60,
        visualLayer: 0,
        transform,
      },
    ];
    const visible = resolveTimelineDocumentFrame({
      items: implicit,
      frame: 75,
    });
    const withHidden = resolveTimelineDocumentFrame({
      items: implicit,
      hiddenVisualLayers: [1],
      frame: 75,
    });
    expect(visible.kind).toBe("shot");
    expect(withHidden.kind).toBe("shot");
    if (visible.kind !== "shot" || withHidden.kind !== "shot") return;
    expect(withHidden.row.item.stableShotId).toBe("base");
    // 隐藏之前和之后，base 落在同一个绝对帧上。
    expect(withHidden.row.startFrame).toBe(60);
    expect(visible.row.startFrame).toBe(60);
  });
});

describe("遗留 overlay 的兼容层跟着图层排序走", () => {
  const legacyOverlay: StoryTimelineOverlay = {
    id: "ov-1",
    kind: "generated-video",
    takeId: 9,
    sourceStableShotId: "legacy",
    videoUrl: "/9.mp4",
    startFrame: 0,
    targetEndFrame: 60,
    mediaEndFrame: 60,
    endFrame: 60,
    stackOrder: 0,
    leftImageId: 1,
    rightImageId: 2,
    transform,
  };

  it("没有字段的历史 overlay 按兼容层 1 解析，压住底层", () => {
    const items = [item("base", { position: 0, startFrame: 0, durationFrames: 60 })];
    expect(exportWinner(items, 30, [], [legacyOverlay])).toBe("overlay:ov-1");
  });

  it("比 overlay 更高的图层赢过 overlay", () => {
    const items = [
      item("base", { position: 0, startFrame: 0, durationFrames: 60 }),
      item("top", {
        position: 1,
        startFrame: 0,
        durationFrames: 60,
        visualLayer: 3,
      }),
    ];
    expect(exportWinner(items, 30, [], [legacyOverlay])).toBe("top");
  });

  it("整层排序会重编号 overlay，它不会停在错误的层", () => {
    const items = [item("base", { position: 0, startFrame: 0, durationFrames: 60 })];
    const moved = moveTimelineVisualLayer({
      items,
      overlays: [legacyOverlay],
      state: { count: 3, hidden: [] },
      from: 1,
      to: 2,
    });
    expect(moved.overlays[0].visualLayer).toBe(2);
    // 隐藏它现在所在的那一层才关得掉它，隐藏旧的 1 层不再误伤。
    expect(exportWinner(items, 30, [1], moved.overlays)).toBe("overlay:ov-1");
    expect(exportWinner(items, 30, [2], moved.overlays)).toBe("base");
  });
});

describe("一帧图片和视频走同一套规则", () => {
  const still = {
    id: "still-1",
    imageId: 1658,
    imageUrl: "/1658.png",
    label: "抽帧",
    offsetFrames: 0,
    timelineStartFrame: 30,
    durationFrames: 1,
    visualLayer: 2,
  };
  const items = [
    item("base", {
      position: 0,
      startFrame: 0,
      durationFrames: 60,
      imageClips: [still],
    }),
  ];

  it("更高层的一帧图片压过下面的视频", () => {
    const image = resolveTimelineImageClipAt({ items, frame: 30 });
    expect(image?.clip.id).toBe("still-1");
    expect(timelineImageBeatsVisualSource(image, 0)).toBe(true);
    expect(timelineImageBeatsVisualSource(image, 5)).toBe(false);
  });

  it("同层显式图片通过统一解析器压过视频", () => {
    const sameLayerItems = [
      item("base", {
        position: 0,
        startFrame: 0,
        durationFrames: 60,
        visualLayer: 2,
        stackOrder: 999,
        imageClips: [{ ...still, visualLayer: 2 }],
      }),
    ];
    const resolution = resolveTimelineFrameSource({
      rows: buildTimelineLayout(sameLayerItems),
      shotsById: new Map([["base", { currentImageId: 42 }]]),
      overlays: [],
      timelineFrame: 30,
    });
    expect(resolution).toMatchObject({
      kind: "source",
      sourceId: "image-1658",
    });
  });

  it("隐藏图片所在层后它不参与解析", () => {
    expect(resolveTimelineImageClipAt({ items, frame: 30, hiddenVisualLayers: [2] })).toBe(
      null
    );
  });

  it("锚点锁住界面上真正显示的那张图片，而不是底下的视频", () => {
    const resolution = resolveTimelineFrameSource({
      rows: buildTimelineLayout(items),
      shotsById: new Map([["base", { currentImageId: 42 }]]),
      overlays: [],
      hiddenVisualLayers: [],
      timelineFrame: 30,
    });
    expect(resolution.kind).toBe("source");
    if (resolution.kind !== "source") return;
    expect(resolution.sourceType).toBe("image");
    expect(resolution.sourceId).toBe("image-1658");
    expect(resolution.durationFrames).toBe(1);
  });

  it("锚定镜头仍然压过更高层的一帧图片", () => {
    const anchoredItems = [
      item("anchored", {
        position: 0,
        startFrame: 0,
        durationFrames: 60,
        visualLayer: 0,
        anchors: [
          {
            id: "anchor-30",
            timelineFrame: 30,
            sourceType: "primary-video",
            sourceId: "take-anchored",
            sourceTimeSec: 1,
          },
        ],
        imageClips: [still],
      }),
    ];
    const resolution = resolveTimelineFrameSource({
      rows: buildTimelineLayout(anchoredItems),
      shotsById: new Map([["anchored", { currentImageId: 42 }]]),
      overlays: [],
      hiddenVisualLayers: [],
      timelineFrame: 30,
    });
    expect(resolution.kind).toBe("source");
    if (resolution.kind !== "source") return;
    expect(resolution.stableShotId).toBe("anchored");
    expect(resolution.sourceId).toBe("image-42");
  });

  it("图片所在层被隐藏时，锚点回落到下层视频", () => {
    const resolution = resolveTimelineFrameSource({
      rows: buildTimelineLayout(items),
      shotsById: new Map([["base", { currentImageId: 42 }]]),
      overlays: [],
      hiddenVisualLayers: [2],
      timelineFrame: 30,
    });
    expect(resolution.kind).toBe("source");
    if (resolution.kind !== "source") return;
    expect(resolution.sourceId).toBe("image-42");
    expect(resolution.stableShotId).toBe("base");
  });
});

describe("磁吸不跨隐藏层", () => {
  it("隐藏层的镜头不再和可见镜头之间造出吸附缝", () => {
    const items = [
      item("base", { position: 0, startFrame: 0, durationFrames: 60 }),
      item("next", { position: 1, startFrame: 60, durationFrames: 60 }),
      // 上层一镜盖住 base 并在同一处收尾：可见时接缝属于它，隐藏后应还给 base。
      item("hiddenTop", {
        position: 2,
        startFrame: 0,
        durationFrames: 60,
        visualLayer: 1,
      }),
    ];
    const rows = buildTimelineLayout(items);
    const withHiddenVisible = timelineMagneticJoins(rows).map(
      join => `${join.leftStableShotId}->${join.rightStableShotId}`
    );
    const withHidden = timelineMagneticJoins(rows, [1]).map(
      join => `${join.leftStableShotId}->${join.rightStableShotId}`
    );
    expect(withHiddenVisible).toContain("hiddenTop->next");
    expect(withHidden).not.toContain("hiddenTop->next");
    expect(withHidden).toContain("base->next");
  });
});
