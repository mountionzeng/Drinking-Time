import { describe, expect, it } from "vitest";
import type { VisualEditDocument } from "./visualClipModel";
import {
  cloneVisualObjectClipboardSnapshot,
  snapshotVisualObjectForClipboard,
} from "./visualObjectClipboard";

function document(): VisualEditDocument {
  return {
    items: [
      {
        stableShotId: "shot-a",
        included: true,
        position: 0,
        plannedDurationMs: 2_000,
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
            id: "image-a",
            imageId: 91,
            imageUrl: "/api/images/91.png",
            label: "抽帧",
            offsetFrames: 12,
            timelineStartFrame: 12,
            durationFrames: 3,
            visualLayer: 2,
            transform: {
              cropX: 0.1,
              cropY: 0.2,
              cropWidth: 0.8,
              cropHeight: 0.7,
              zoom: 1.25,
              panX: 0.1,
              panY: -0.1,
            },
          },
        ],
      },
    ],
  };
}

describe("visual object clipboard snapshots", () => {
  it("captures an immutable image value without carrying its storage host", () => {
    const source = document();
    const snapshot = snapshotVisualObjectForClipboard({
      storyId: 7,
      document: source,
      object: {
        type: "image-clip",
        clipId: "image-a",
        ownerStableShotId: "shot-a",
      },
    });

    expect(snapshot).toMatchObject({
      version: 1,
      kind: "image-clip",
      sourceStoryId: 7,
      sourceClipId: "image-a",
      sourceLayer: 2,
      imageId: 91,
      durationFrames: 3,
      transform: { zoom: 1.25 },
    });
    expect(snapshot).not.toHaveProperty("ownerStableShotId");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.transform)).toBe(true);
  });

  it("does not drift after the source clip moves, changes, or is deleted", () => {
    const source = document();
    const snapshot = snapshotVisualObjectForClipboard({
      storyId: 7,
      document: source,
      object: {
        type: "image-clip",
        clipId: "image-a",
        ownerStableShotId: "shot-a",
      },
    });
    const clip = source.items[0].imageClips![0];
    clip.visualLayer = 8;
    clip.imageUrl = "/changed.png";
    clip.transform!.zoom = 4;
    source.items[0].imageClips = [];

    expect(snapshot).toMatchObject({
      sourceLayer: 2,
      imageUrl: "/api/images/91.png",
      transform: { zoom: 1.25 },
    });
  });

  it("returns null for a stale identity or unsupported object kind", () => {
    expect(
      snapshotVisualObjectForClipboard({
        storyId: 7,
        document: document(),
        object: {
          type: "image-clip",
          clipId: "missing",
          ownerStableShotId: "shot-a",
        },
      })
    ).toBeNull();
    expect(
      snapshotVisualObjectForClipboard({
        storyId: 7,
        document: document(),
        object: { type: "story-shot", stableShotId: "shot-a", shotNo: 1 },
      })
    ).toBeNull();
  });

  it("clones nested transform values at a session boundary", () => {
    const snapshot = snapshotVisualObjectForClipboard({
      storyId: 7,
      document: document(),
      object: {
        type: "image-clip",
        clipId: "image-a",
        ownerStableShotId: "shot-a",
      },
    })!;
    const clone = cloneVisualObjectClipboardSnapshot(snapshot);
    expect(clone).toEqual(snapshot);
    expect(clone).not.toBe(snapshot);
    expect(clone.transform).not.toBe(snapshot.transform);
  });
});
