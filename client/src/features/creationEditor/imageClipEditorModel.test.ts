import { describe, expect, it } from "vitest";

import { DEFAULT_TIMELINE_TRANSFORM } from "@shared/storyMaterial";
import {
  imageClipEditorTargetForShot,
  normalizeImageClipEditDraft,
  timelineTransformStyle,
} from "./imageClipEditorModel";

describe("imageClipEditorModel", () => {
  it("allows images to shrink and normalizes rotation and position", () => {
    expect(
      normalizeImageClipEditDraft({
        ...DEFAULT_TIMELINE_TRANSFORM,
        zoom: 0.1,
        panX: 5,
        panY: -5,
        rotationDeg: 450,
        flipX: true,
      })
    ).toMatchObject({
      zoom: 0.25,
      panX: 1,
      panY: -1,
      rotationDeg: 180,
      flipX: true,
      flipY: false,
    });
  });

  it("builds an editor target from the persisted shot transform", () => {
    const target = imageClipEditorTargetForShot({
      stableShotId: "shot-0101",
      imageId: 12,
      imageUrl: "/image.png",
      label: "0101 · 首帧",
      shot: {
        shotNo: 1,
        shotKey: "shot-0101",
        stableShotId: "shot-0101",
        timelineItem: {
          stableShotId: "shot-0101",
          included: true,
          position: 0,
          plannedDurationMs: 3000,
          transform: {
            ...DEFAULT_TIMELINE_TRANSFORM,
            zoom: 0.75,
            rotationDeg: -90,
          },
        },
      },
    });

    expect(target).toMatchObject({
      stableShotId: "shot-0101",
      imageId: 12,
      transform: { zoom: 0.75, rotationDeg: -90 },
    });
    expect(timelineTransformStyle(target.transform)?.transform).toContain(
      "rotate(-90deg) scale(0.75)"
    );
  });

  it("renders a missing legacy rotation as upright", () => {
    expect(
      timelineTransformStyle({
        ...DEFAULT_TIMELINE_TRANSFORM,
        rotationDeg: undefined,
      })?.transform
    ).toContain("rotate(0deg)");
  });
});
