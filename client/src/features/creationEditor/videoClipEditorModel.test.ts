import { describe, expect, it } from "vitest";

import {
  editedTimelineDurationMs,
  normalizeVideoClipEditDraft,
  videoClipEditorTargetForVisualClip,
} from "./videoClipEditorModel";

const transform = {
  cropX: 0,
  cropY: 0,
  cropWidth: 1,
  cropHeight: 1,
  zoom: 1,
  panX: 0,
  panY: 0,
};

describe("video clip editor model", () => {
  it("clamps editable values and derives output duration from source and speed", () => {
    const draft = normalizeVideoClipEditDraft(
      {
        sourceStartSec: -1,
        sourceEndSec: 9,
        effects: {
          playbackRate: 2,
          reverse: true,
          volume: 3,
          muted: false,
        },
        transform: { ...transform, zoom: 12, panX: -4 },
      },
      4
    );

    expect(draft).toMatchObject({
      sourceStartSec: 0,
      sourceEndSec: 4,
      effects: { playbackRate: 2, reverse: true, volume: 2 },
      transform: { zoom: 8, panX: -1 },
    });
    expect(editedTimelineDurationMs(draft)).toBe(2_000);
  });

  it("keeps a visual clip's own effects and transform", () => {
    const target = videoClipEditorTargetForVisualClip({
      stableShotId: "shot-a",
      shotNo: 1,
      label: "0101 前段",
      clip: {
        id: "clip-a",
        takeId: 9,
        rangeId: 3,
        sourceStableShotId: "shot-a",
        videoUrl: "/api/videos/9",
        label: "前段",
        sourceStartSec: 1,
        sourceEndSec: 3,
        offsetMs: 0,
        durationMs: 4_000,
        effects: {
          playbackRate: 0.5,
          reverse: true,
          volume: 0.6,
          muted: false,
        },
        transform: { ...transform, zoom: 2 },
      },
    });

    expect(target.effects).toMatchObject({ playbackRate: 0.5, reverse: true });
    expect(target.transform.zoom).toBe(2);
  });
});
