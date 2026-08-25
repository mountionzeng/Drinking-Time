import { describe, expect, it } from "vitest";
import type { VisualEditDocument } from "./visualClipModel";
import { projectVisualClips } from "./visualClipModel";
import type { ImageClipClipboardSnapshot } from "./visualObjectClipboard";
import {
  deleteVisualObjectReference,
  pasteImageClipboardSnapshot,
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
      expect.arrayContaining([
        expect.objectContaining({ id: "video:owned-a" }),
      ])
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
        expect.arrayContaining([expect.objectContaining({ id: "video:owned-a" })])
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
