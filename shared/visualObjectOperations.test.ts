import { describe, expect, it } from "vitest";
import type { VisualEditDocument } from "./visualClipModel";
import { projectVisualClips } from "./visualClipModel";
import type {
  ImageClipClipboardSnapshot,
  StoryShotClipboardSnapshot,
} from "./visualObjectClipboard";
import {
  deleteStoryShotAggregate,
  deleteVisualObjectReference,
  pasteImageClipboardSnapshot,
  pasteStoryShotClipboardSnapshot,
} from "./visualObjectOperations";

const snapshot: ImageClipClipboardSnapshot = Object.freeze({
  version: 1,
  kind: "image-clip",
  sourceStoryId: 7,
  sourceClipId: "source-image",
  sourceLayer: 1,
  imageId: 91,
  imageUrl: "/old-url.png",
  label: "仓库图片",
  durationFrames: 4,
  transform: Object.freeze({
    cropX: 0.1,
    cropY: 0.2,
    cropWidth: 0.8,
    cropHeight: 0.7,
    zoom: 1.2,
    panX: 0.1,
    panY: 0,
  }),
});

function document(): VisualEditDocument {
  return {
    items: [
      {
        stableShotId: "shot-a",
        included: true,
        position: 0,
        plannedDurationMs: 2_000,
        timelineStartFrame: 0,
        durationFrames: 60,
        transform: {
          cropX: 0,
          cropY: 0,
          cropWidth: 1,
          cropHeight: 1,
          zoom: 1,
          panX: 0,
          panY: 0,
        },
        imageClips: [
          {
            id: "source-image",
            imageId: 91,
            imageUrl: "/old-url.png",
            label: "仓库图片",
            offsetFrames: 2,
            timelineStartFrame: 2,
            durationFrames: 4,
            visualLayer: 1,
          },
        ],
        visualClips: [
          {
            id: "owned-a",
            takeId: 4,
            rangeId: 2,
            sourceStableShotId: "shot-a",
            videoUrl: "/4.mp4",
            label: "片段",
            sourceStartSec: 0,
            sourceEndSec: 1,
            offsetMs: 0,
            durationMs: 1_000,
          },
        ],
      },
    ],
  };
}

describe("visual object operations", () => {
  it("pastes an independent clip with the same warehouse image and visible values", () => {
    const result = pasteImageClipboardSnapshot({
      document: document(),
      storyId: 7,
      snapshot,
      newClipId: "pasted-image",
      targetFrame: 30,
      targetLayer: 3,
      canonicalImageUrl: "/canonical-91.png",
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(projectVisualClips(result.document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "image:pasted-image",
          trackId: "track-3",
          startFrame: 30,
          durationFrames: 4,
        }),
      ])
    );
    const pasted = result.document.items
      .flatMap(item => item.imageClips ?? [])
      .find(clip => clip.id === "pasted-image");
    expect(pasted).toMatchObject({
      imageId: 91,
      imageUrl: "/canonical-91.png",
      transform: { zoom: 1.2 },
    });
    expect(pasted).not.toBe(
      result.document.items[0].imageClips?.find(
        clip => clip.id === "source-image"
      )
    );
  });

  it("pastes a shot with fresh identities at the end of an equal-start group", () => {
    const aggregate = {
      shots: [
        { stableShotId: "a", shotIdentity: "a", shotNo: 1, subject: "A" },
        { stableShotId: "b", shotIdentity: "b", shotNo: 2, subject: "B" },
        { stableShotId: "c", shotIdentity: "c", shotNo: 3, subject: "C" },
      ],
      document: {
        // Array order is intentionally stale. `position` is the canonical
        // existing Story order and must remain stable inside the equal-start group.
        items: [
          {
            ...document().items[0],
            stableShotId: "c",
            position: 2,
            timelineStartFrame: 60,
            imageClips: [],
            visualClips: [],
          },
          {
            ...document().items[0],
            stableShotId: "a",
            position: 0,
            timelineStartFrame: 0,
            imageClips: [],
            visualClips: [],
          },
          {
            ...document().items[0],
            stableShotId: "b",
            position: 1,
            timelineStartFrame: 60,
            imageClips: [],
            visualClips: [],
          },
        ],
      },
    };
    const shotSnapshot: StoryShotClipboardSnapshot = Object.freeze({
      version: 1,
      kind: "story-shot",
      sourceStoryId: 7,
      sourceStableShotId: "source",
      sourceLayer: 2,
      shot: Object.freeze({ subject: "副本", action: "保留动作" }),
      timeline: Object.freeze({
        included: true,
        plannedDurationMs: 1_000,
        durationFrames: 30,
        transform: Object.freeze({
          cropX: 0,
          cropY: 0,
          cropWidth: 1,
          cropHeight: 1,
          zoom: 1,
          panX: 0,
          panY: 0,
        }),
        primaryVideoEdit: Object.freeze({
          takeId: 44,
          sourceStartSec: 1,
          sourceEndSec: 2,
          effects: Object.freeze({
            playbackRate: 1,
            reverse: false,
            volume: 1,
            muted: false,
          }),
        }),
        visualClipsReplacePrimary: true,
        visualClips: Object.freeze([
          Object.freeze({
            id: "old-owned",
            takeId: 45,
            rangeId: 3,
            sourceStableShotId: "media",
            videoUrl: "/45.mp4",
            label: "保留编辑",
            sourceStartSec: 2,
            sourceEndSec: 3,
            offsetMs: 100,
            durationMs: 900,
            visualLayer: 4,
          }),
        ]),
      }),
    });
    const result = pasteStoryShotClipboardSnapshot({
      aggregate,
      storyId: 7,
      snapshot: shotSnapshot,
      newStableShotId: "pasted",
      newOwnedClipIds: ["new-owned"],
      targetFrame: 60,
      targetLayer: 6,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(
      result.aggregate.document.items.map(item => item.stableShotId)
    ).toEqual(["a", "b", "c", "pasted"]);
    expect(result.aggregate.document.items.map(item => item.position)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(
      result.aggregate.document.items.map(item => item.timelineStartFrame)
    ).toEqual([0, 60, 60, 60]);
    expect(result.aggregate.shots.map(shot => shot.shotNo)).toEqual([
      1, 2, 3, 4,
    ]);
    const pasted = result.aggregate.document.items[3];
    expect(pasted).toMatchObject({
      stableShotId: "pasted",
      timelineStartFrame: 60,
      visualLayer: 6,
    });
    expect(pasted).not.toHaveProperty("referencedImageId");
    expect(pasted.visualClips).toEqual([
      expect.objectContaining({
        id: "new-owned",
        takeId: 45,
        rangeId: 3,
        sourceStableShotId: "pasted",
        visualLayer: 8,
      }),
    ]);
    expect(pasted).not.toHaveProperty("anchors");
    expect(pasted).not.toHaveProperty("imageClips");
  });

  it("materializes implicit positions and rehosts independent images without visible drift", () => {
    const transform = {
      cropX: 0.2,
      cropY: 0.1,
      cropWidth: 0.7,
      cropHeight: 0.8,
      zoom: 1.4,
      panX: 0.2,
      panY: -0.2,
    };
    const baseItem = document().items[0];
    const aggregate = {
      shots: [
        { stableShotId: "left", shotNo: 1 },
        { stableShotId: "delete", shotNo: 2 },
        { stableShotId: "cover", shotNo: 3 },
      ],
      document: {
        items: [
          {
            ...baseItem,
            stableShotId: "left",
            position: 0,
            durationFrames: 30,
            timelineStartFrame: undefined,
            imageClips: [],
            visualClips: [],
          },
          {
            ...baseItem,
            stableShotId: "delete",
            position: 1,
            durationFrames: 30,
            timelineStartFrame: undefined,
            visualLayer: 2,
            visualClips: [{ ...baseItem.visualClips![0], id: "owned-doomed" }],
            imageClips: [
              {
                id: "keep-image",
                imageId: 500,
                imageUrl: "/500.png",
                label: "必须保留",
                offsetFrames: 5,
                durationFrames: 7,
                visualLayer: 4,
                transform,
                stackOrder: 77,
              },
            ],
          },
          {
            ...baseItem,
            stableShotId: "cover",
            position: 2,
            durationFrames: 40,
            timelineStartFrame: 30,
            visualLayer: 0,
            imageClips: [],
            visualClips: [],
          },
        ],
      },
    };
    const result = deleteStoryShotAggregate({
      aggregate,
      stableShotId: "delete",
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.aggregate.shots).toEqual([
      expect.objectContaining({ stableShotId: "left", shotNo: 1 }),
      expect.objectContaining({ stableShotId: "cover", shotNo: 2 }),
    ]);
    expect(
      result.aggregate.document.items.flatMap(item => item.visualClips ?? [])
    ).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "owned-doomed" })])
    );
    const host = result.aggregate.document.items.find(
      item => item.stableShotId === "cover"
    )!;
    expect(host.imageClips).toEqual([
      {
        id: "keep-image",
        imageId: 500,
        imageUrl: "/500.png",
        label: "必须保留",
        offsetFrames: 5,
        timelineStartFrame: 35,
        durationFrames: 7,
        visualLayer: 4,
        transform,
        stackOrder: 77,
      },
    ]);
  });

  it("rejects the final shot and any reused or incomplete paste identities", () => {
    const one = {
      shots: [{ stableShotId: "shot-a", shotNo: 1 }],
      document: document(),
    };
    expect(
      deleteStoryShotAggregate({ aggregate: one, stableShotId: "shot-a" })
    ).toMatchObject({ status: "error", error: "last-shot" });
    const minimal: StoryShotClipboardSnapshot = {
      version: 1,
      kind: "story-shot",
      sourceStoryId: 7,
      sourceStableShotId: "shot-a",
      sourceLayer: 0,
      shot: {},
      timeline: {
        included: true,
        plannedDurationMs: 1000,
        durationFrames: 30,
        transform: document().items[0].transform,
        visualClipsReplacePrimary: false,
        visualClips: document().items[0].visualClips!,
      },
    };
    expect(
      pasteStoryShotClipboardSnapshot({
        aggregate: one,
        storyId: 7,
        snapshot: minimal,
        newStableShotId: "shot-a",
        newOwnedClipIds: ["fresh"],
        targetFrame: 0,
        targetLayer: 0,
      })
    ).toMatchObject({ status: "error", error: "identity-reused" });
    expect(
      pasteStoryShotClipboardSnapshot({
        aggregate: one,
        storyId: 7,
        snapshot: minimal,
        newStableShotId: "fresh-shot",
        newOwnedClipIds: [],
        targetFrame: 0,
        targetLayer: 0,
      })
    ).toMatchObject({ status: "error", error: "clip-identity-count-mismatch" });
  });

  it("rejects a stale Story clipboard or reused source identity", () => {
    expect(
      pasteImageClipboardSnapshot({
        document: document(),
        storyId: 8,
        snapshot,
        newClipId: "new",
        targetFrame: 0,
        targetLayer: 0,
      })
    ).toMatchObject({ status: "error", error: "story-mismatch" });
    expect(
      pasteImageClipboardSnapshot({
        document: document(),
        storyId: 7,
        snapshot,
        newClipId: "source-image",
        targetFrame: 0,
        targetLayer: 0,
      })
    ).toMatchObject({ status: "error", error: "clip-identity-reused" });
  });

  it("deletes only the selected image reference", () => {
    const source = document();
    const result = deleteVisualObjectReference({
      document: source,
      object: {
        type: "image-clip",
        ownerStableShotId: "shot-a",
        clipId: "source-image",
      },
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(projectVisualClips(result.document)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "image:source-image" }),
      ])
    );
    expect(projectVisualClips(result.document)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "video:owned-a" })])
    );
  });

  it("uses owner identity when legacy data repeats a clip id", () => {
    const source = document();
    source.items.push({
      ...source.items[0],
      stableShotId: "shot-b",
      position: 1,
      timelineStartFrame: 60,
      imageClips: [
        {
          ...source.items[0].imageClips![0],
          id: "source-image",
          timelineStartFrame: 70,
        },
      ],
      visualClips: [],
    });
    const result = deleteVisualObjectReference({
      document: source,
      object: {
        type: "image-clip",
        ownerStableShotId: "shot-b",
        clipId: "source-image",
      },
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.document.items[0].imageClips).toHaveLength(1);
    expect(result.document.items[1].imageClips).toHaveLength(0);
  });

  it("deletes an owned segment narrowly and refuses aggregate shot delete", () => {
    const removed = deleteVisualObjectReference({
      document: document(),
      object: {
        type: "owned-video-clip",
        ownerStableShotId: "shot-a",
        clipId: "owned-a",
      },
    });
    expect(removed.status).toBe("ok");
    if (removed.status === "ok") {
      expect(projectVisualClips(removed.document)).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "video:owned-a" }),
        ])
      );
      expect(removed.document.items[0].visualClipsReplacePrimary).toBe(false);
    }
    expect(
      deleteVisualObjectReference({
        document: document(),
        object: { type: "story-shot", stableShotId: "shot-a", shotNo: 1 },
      })
    ).toMatchObject({ status: "error", error: "unsupported-kind" });
  });
});
