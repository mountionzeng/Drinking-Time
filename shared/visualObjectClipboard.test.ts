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
    expect(snapshot?.kind).toBe("image-clip");
    if (snapshot?.kind === "image-clip") {
      expect(Object.isFrozen(snapshot.transform)).toBe(true);
    }
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
    expect(clone.kind).toBe("image-clip");
    if (clone.kind === "image-clip" && snapshot.kind === "image-clip") {
      expect(clone.transform).not.toBe(snapshot.transform);
    }
  });

  it("allow-lists a story shot and excludes identity, placement, images, and poison fields", () => {
    const source = document();
    source.items[0].anchors = [
      {
        id: "anchor",
        timelineFrame: 1,
        sourceType: "image",
        sourceId: "91",
        sourceTimeSec: null,
      },
    ];
    source.items[0].stackOrder = 99;
    source.items[0].primaryVideoEdit = {
      takeId: 8,
      sourceStartSec: 1,
      sourceEndSec: 2,
      effects: { playbackRate: 1.5, reverse: false, volume: 0.8, muted: false },
    };
    source.items[0].visualClips = [
      {
        id: "owned-old",
        takeId: 9,
        rangeId: 4,
        sourceStableShotId: "media-source",
        videoUrl: "/9.mp4",
        label: "切片",
        sourceStartSec: 2,
        sourceEndSec: 3,
        offsetMs: 100,
        durationMs: 1_000,
        visualLayer: 5,
      },
    ];
    const snapshot = snapshotVisualObjectForClipboard({
      storyId: 7,
      document: source,
      storyShots: [
        {
          shotNo: 1,
          stableShotId: "shot-a",
          shotIdentity: "shot-a",
          shotKey: "shot-a",
          subject: "人物",
          action: "走路",
          promptDraft: "可见提示词",
          promptOverrides: { cameraMove: { value: "缓慢推近" } },
          narrativeJob: { intentSummary: "保留叙事任务" },
          anchors: ["poison"],
          imageClips: ["poison"],
          timelineStartFrame: 999,
          stackOrder: 999,
          taskId: "paid-task",
          receipt: "secret",
          paidCredits: 100,
          unknownPoison: { leaked: true },
        },
      ],
      object: { type: "story-shot", stableShotId: "shot-a", shotNo: 1 },
    });
    expect(snapshot?.kind).toBe("story-shot");
    if (snapshot?.kind !== "story-shot") return;
    expect(snapshot.shot).toEqual({
      subject: "人物",
      action: "走路",
      promptDraft: "可见提示词",
      promptOverrides: { cameraMove: { value: "缓慢推近" } },
      narrativeJob: { intentSummary: "保留叙事任务" },
    });
    expect(snapshot.timeline).toMatchObject({
      primaryVideoEdit: { takeId: 8, effects: { playbackRate: 1.5 } },
      visualClips: [{ id: "owned-old", takeId: 9, visualLayer: 5 }],
    });
    expect(snapshot.timeline).not.toHaveProperty("anchors");
    expect(snapshot.timeline).not.toHaveProperty("imageClips");
    expect(snapshot.timeline).not.toHaveProperty("timelineStartFrame");
    expect(snapshot.timeline).not.toHaveProperty("stackOrder");
    expect(Object.isFrozen(snapshot.timeline.visualClips[0])).toBe(true);
  });
});
