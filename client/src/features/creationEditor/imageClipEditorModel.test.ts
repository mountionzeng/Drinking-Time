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
        dialogue: "这句旁白应当自动带入",
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
      textOverlay: null,
      defaultText: "这句旁白应当自动带入",
    });
    expect(timelineTransformStyle(target.transform)?.transform).toContain(
      "rotate(-90deg) scale(0.75)"
    );
  });

  it("keeps an existing image text layer ahead of the shot dialogue", () => {
    const shot = {
      shotNo: 1,
      shotKey: "shot-0101",
      stableShotId: "shot-0101",
      dialogue: "镜头旁白",
      timelineItem: {
        stableShotId: "shot-0101",
        included: true,
        position: 0,
        plannedDurationMs: 3000,
        transform: { ...DEFAULT_TIMELINE_TRANSFORM },
        imageTextOverlays: {
          "42": {
            text: "用户已经编辑过的文字",
            typography: {
              layoutVersion: 1 as const,
              fontId: "noto-serif-sc",
              alignment: "center" as const,
              fontSize: 48,
              letterSpacing: 2,
              lineSpacing: 1.3,
              contrast: {
                textColor: "#ffffff",
                outlineColor: "#000000",
                outlineWidth: 1.5,
                backdropColor: null,
              },
              kind: "region" as const,
              shape: "rectangle" as const,
              direction: "horizontal" as const,
              region: { x: 0.1, y: 0.7, width: 0.8, height: 0.2 },
            },
          },
        },
      },
    };

    const target = imageClipEditorTargetForShot({
      shot,
      stableShotId: "shot-0101",
      imageId: 42,
      imageUrl: "/image.png",
      label: "0101 · 首帧",
    });

    expect(target.defaultText).toBe("镜头旁白");
    expect(target.textOverlay?.text).toBe("用户已经编辑过的文字");
  });

  it("renders a missing legacy rotation as upright", () => {
    expect(
      timelineTransformStyle({
        ...DEFAULT_TIMELINE_TRANSFORM,
        rotationDeg: undefined,
      })?.transform
    ).toContain("rotate(0deg)");
  });

  it("uses the selected image transform instead of linking sibling frames", () => {
    const shot = {
      shotNo: 5,
      shotKey: "shot-0305",
      stableShotId: "shot-0305",
      timelineItem: {
        stableShotId: "shot-0305",
        included: true,
        position: 0,
        plannedDurationMs: 3000,
        transform: { ...DEFAULT_TIMELINE_TRANSFORM, zoom: 1.1 },
        imageTransforms: {
          "1604": { ...DEFAULT_TIMELINE_TRANSFORM, zoom: 1.8 },
          "1612": { ...DEFAULT_TIMELINE_TRANSFORM, zoom: 0.7 },
        },
      },
    };

    expect(
      imageClipEditorTargetForShot({
        shot,
        stableShotId: "shot-0305",
        imageId: 1604,
        imageUrl: "/first.png",
        label: "0305 · 首帧",
      }).transform.zoom
    ).toBe(1.8);
    expect(
      imageClipEditorTargetForShot({
        shot,
        stableShotId: "shot-0305",
        imageId: 1612,
        imageUrl: "/last.png",
        label: "0305 · 尾帧",
      }).transform.zoom
    ).toBe(0.7);
  });

  it("loads text only from the selected image overlay", () => {
    const typography = {
      layoutVersion: 1 as const,
      fontId: "noto-serif-sc",
      alignment: "center" as const,
      fontSize: 48,
      letterSpacing: 0,
      lineSpacing: 1.3,
      contrast: {
        textColor: "#ffffff",
        outlineColor: "#000000",
        outlineWidth: 1.5,
        backdropColor: null,
      },
      kind: "region" as const,
      shape: "rectangle" as const,
      direction: "horizontal" as const,
      region: { x: 0.1, y: 0.7, width: 0.8, height: 0.2 },
    };
    const shot = {
      shotNo: 5,
      shotKey: "shot-0305",
      stableShotId: "shot-0305",
      timelineItem: {
        stableShotId: "shot-0305",
        included: true,
        position: 0,
        plannedDurationMs: 3000,
        transform: { ...DEFAULT_TIMELINE_TRANSFORM },
        imageTextOverlays: {
          "1604": { text: "只属于首帧", typography },
          "1612": { text: "只属于尾帧", typography },
        },
      },
    };

    expect(
      imageClipEditorTargetForShot({
        shot,
        stableShotId: "shot-0305",
        imageId: 1604,
        imageUrl: "/first.png",
        label: "0305 · 首帧",
      }).textOverlay?.text
    ).toBe("只属于首帧");
  });
});
