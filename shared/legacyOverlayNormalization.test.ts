import { describe, expect, it } from "vitest";
import {
  normalizeLegacyOverlay,
  type LegacyOverlayNormalizationInput,
} from "./legacyOverlayNormalization";
import type {
  StoryTimelineItem,
  StoryTimelineOverlay,
  TimelineTransform,
} from "./storyMaterial";

const transform: TimelineTransform = {
  cropX: 0.1,
  cropY: 0.2,
  cropWidth: 0.7,
  cropHeight: 0.6,
  zoom: 1.25,
  panX: 0.3,
  panY: -0.2,
  rotationDeg: 4,
  flipX: true,
};

const target: StoryTimelineOverlay = {
  id: "overlay-target",
  kind: "generated-video",
  takeId: 41,
  sourceStableShotId: "transition-shot",
  videoUrl: "/media/transition.mp4",
  startFrame: 75,
  targetEndFrame: 180,
  mediaEndFrame: 165,
  endFrame: 180,
  stackOrder: 23,
  visualLayer: 4,
  leftImageId: 11,
  rightImageId: 12,
  transform,
  effects: {
    playbackRate: 0.8,
    reverse: true,
    volume: 0.6,
    muted: false,
    motionPreset: { kind: "heartbeat", bpm: 72, scaleAmount: 0.05 },
  },
};

const item: StoryTimelineItem = {
  stableShotId: "transition-shot",
  included: true,
  position: 1,
  plannedDurationMs: 3_000,
  durationFrames: 90,
  timelineStartFrame: 10,
  stackOrder: 2,
  visualLayer: 1,
  transform: {
    cropX: 0,
    cropY: 0,
    cropWidth: 1,
    cropHeight: 1,
    zoom: 1,
    panX: 0,
    panY: 0,
  },
  primaryVideoEdit: {
    takeId: 41,
    sourceStartSec: 0.25,
    sourceEndSec: 3.25,
    effects: { playbackRate: 1, reverse: false, volume: 1, muted: false },
  },
};

function input(
  overrides: Partial<LegacyOverlayNormalizationInput> = {}
): LegacyOverlayNormalizationInput {
  return {
    overlayId: target.id,
    sourceStableShotId: target.sourceStableShotId,
    expectedVideoUrl: target.videoUrl,
    storyShots: [
      { stableShotId: "shot-a", shotIdentity: "shot-a" },
      {
        stableShotId: target.sourceStableShotId,
        shotIdentity: target.sourceStableShotId,
      },
    ],
    document: {
      items: [
        { ...item, stableShotId: "shot-a", primaryVideoEdit: undefined },
        item,
      ],
      overlays: [
        { ...target, id: "overlay-other", sourceStableShotId: "shot-a" },
        target,
      ],
      visualLayerState: { count: 6, hidden: [3] },
    },
    takes: [
      {
        id: 41,
        stableShotId: target.sourceStableShotId,
        videoUrl: target.videoUrl,
      },
    ],
    ...overrides,
  };
}

describe("normalizeLegacyOverlay", () => {
  it("moves the target overlay's visible facts to its canonical item and removes only it", () => {
    const original = input();
    const result = normalizeLegacyOverlay(original);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.changed).toBe(true);
    expect(result.removedOverlay).toEqual(target);
    expect(result.document.overlays).toEqual([original.document.overlays?.[0]]);
    expect(result.document.items[0]).toBe(original.document.items[0]);
    expect(result.document.items[1]).toMatchObject({
      timelineStartFrame: 75,
      durationFrames: 90,
      plannedDurationMs: 3_000,
      visualLayer: 4,
      stackOrder: 23,
      transform,
      primaryVideoEdit: {
        takeId: 41,
        sourceStartSec: 0.25,
        sourceEndSec: 3.25,
        effects: target.effects,
      },
    });
    expect(result.document.visualLayerState).toBe(
      original.document.visualLayerState
    );
    result.normalizedItem.transform.panX = 99;
    result.normalizedItem.primaryVideoEdit!.effects.motionPreset!.bpm = 120;
    expect(target.transform.panX).toBe(0.3);
    expect(target.effects?.motionPreset?.bpm).toBe(72);
    expect(original.document.items[1]).toEqual(item);
    expect(original.document.overlays).toHaveLength(2);
  });

  it("accepts shotKey as the canonical Story shot identity", () => {
    const result = normalizeLegacyOverlay(
      input({ storyShots: [{ shotKey: target.sourceStableShotId }] })
    );
    expect(result).toMatchObject({ status: "ok", changed: true });
  });

  it("uses legacy layer 1 and preserves primary effects when overlay effects are absent", () => {
    const legacyOverlay = {
      ...target,
      visualLayer: undefined,
      effects: undefined,
    };
    const original = input({
      document: { items: [item], overlays: [legacyOverlay] },
    });
    const result = normalizeLegacyOverlay(original);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.document.items[0]).toMatchObject({
      visualLayer: 1,
      primaryVideoEdit: { effects: item.primaryVideoEdit?.effects },
    });
    result.normalizedItem.primaryVideoEdit!.effects.playbackRate = 3;
    expect(item.primaryVideoEdit?.effects.playbackRate).toBe(1);
  });

  it("is idempotent for a canonical item after the overlay is gone", () => {
    const first = normalizeLegacyOverlay(input());
    expect(first.status).toBe("ok");
    if (first.status !== "ok") return;
    const secondInput = input({ document: first.document });
    const second = normalizeLegacyOverlay(secondInput);
    expect(second).toEqual({
      status: "ok",
      changed: false,
      document: first.document,
      normalizedItem: first.document.items[1],
      removedOverlay: null,
    });
  });

  it.each([
    ["missing-story-shot", { storyShots: [{ stableShotId: "shot-a" }] }],
    [
      "ambiguous-story-shot",
      {
        storyShots: [
          { stableShotId: "transition-shot" },
          { shotIdentity: "transition-shot" },
        ],
      },
    ],
    ["missing-timeline-item", { document: { items: [], overlays: [target] } }],
    [
      "ambiguous-timeline-item",
      { document: { items: [item, { ...item }], overlays: [target] } },
    ],
    ["missing-take", { takes: [] }],
    [
      "ambiguous-take",
      {
        takes: [
          {
            id: 41,
            stableShotId: "transition-shot",
            videoUrl: target.videoUrl,
          },
          {
            id: 41,
            stableShotId: "transition-shot",
            videoUrl: target.videoUrl,
          },
        ],
      },
    ],
    [
      "missing-primary-edit",
      {
        document: {
          items: [{ ...item, primaryVideoEdit: undefined }],
          overlays: [target],
        },
      },
    ],
    [
      "binding-mismatch",
      {
        takes: [
          { id: 41, stableShotId: "another-shot", videoUrl: target.videoUrl },
        ],
      },
    ],
    [
      "binding-mismatch",
      {
        takes: [
          {
            id: 41,
            stableShotId: "transition-shot",
            videoUrl: "/media/other.mp4",
          },
        ],
      },
    ],
    [
      "binding-mismatch",
      {
        document: {
          items: [
            {
              ...item,
              primaryVideoEdit: { ...item.primaryVideoEdit!, takeId: 99 },
            },
          ],
          overlays: [target],
        },
      },
    ],
    [
      "ambiguous-overlay",
      { document: { items: [item], overlays: [target, { ...target }] } },
    ],
    [
      "ambiguous-overlay",
      {
        document: {
          items: [item],
          overlays: [target, { ...target, id: "another" }],
        },
      },
    ],
  ] as const)("returns %s without mutating input", (error, override) => {
    const original = input(
      override as Partial<LegacyOverlayNormalizationInput>
    );
    const before = structuredClone(original);
    const result = normalizeLegacyOverlay(original);
    expect(result).toMatchObject({ status: "error", error });
    expect(original).toEqual(before);
  });

  it("rejects an absent overlay when the canonical binding does not match", () => {
    const original = input({
      document: { items: [item], overlays: [] },
      takes: [{ id: 41, stableShotId: "transition-shot", videoUrl: "/wrong" }],
    });
    expect(normalizeLegacyOverlay(original)).toMatchObject({
      status: "error",
      error: "binding-mismatch",
    });
  });
});
