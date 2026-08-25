import { describe, expect, it } from "vitest";

import {
  createTimelineViewport,
  framePx,
  frameToPx,
} from "@shared/timelineViewport";

import {
  buildStoryboardMatrixLayout,
  shouldCompactStoryboardMatrixForShot,
  updateStoryboardMatrixTimingPreview,
} from "./storyboardMatrixLayout";

describe("storyboard matrix timeline layout", () => {
  it("uses the viewport frame scale even when a short timeline expands to the 720px minimum", () => {
    const viewport = createTimelineViewport({ totalMs: 4_000, scale: 16 });
    const layout = buildStoryboardMatrixLayout({
      entries: [
        { originalIndex: 0, stableShotId: "shot-a" },
        { originalIndex: 1, stableShotId: "shot-c" },
        { originalIndex: 2, stableShotId: "shot-b" },
      ],
      timings: [
        { stableShotId: "shot-a", startFrame: 0, endFrame: 20 },
        { stableShotId: "shot-b", startFrame: 30, endFrame: 70 },
        { stableShotId: "shot-c", startFrame: 90, endFrame: 120 },
      ],
      pixelsPerFrame: framePx(viewport),
      targetWidth: viewport.contentWidth,
    });

    expect(viewport.contentWidth).toBe(720);
    expect(layout.entries.map(entry => entry.stableShotId)).toEqual([
      "shot-a",
      "shot-b",
      "shot-c",
    ]);
    expect(layout.widths).toEqual([
      frameToPx(viewport, 30),
      frameToPx(viewport, 60),
      viewport.contentWidth - frameToPx(viewport, 90),
    ]);
    expect(layout.startOffsets).toEqual([
      frameToPx(viewport, 0),
      frameToPx(viewport, 30),
      frameToPx(viewport, 90),
    ]);
  });

  it("keeps shots missing from the timeline editable at the end", () => {
    const viewport = createTimelineViewport({ totalMs: 2_000, scale: 16 });
    const layout = buildStoryboardMatrixLayout({
      entries: [
        { originalIndex: 0, stableShotId: "draft" },
        { originalIndex: 1, stableShotId: "shot-a" },
      ],
      timings: [{ stableShotId: "shot-a", startFrame: 0, endFrame: 60 }],
      pixelsPerFrame: framePx(viewport),
      targetWidth: viewport.contentWidth,
      unplacedWidth: 72,
    });

    expect(layout.entries.map(entry => entry.stableShotId)).toEqual([
      "shot-a",
      "draft",
    ]);
    expect(layout.widths).toEqual([viewport.contentWidth, 72]);
    expect(layout.startOffsets).toEqual([0, viewport.contentWidth]);
  });

  it("uses a transient shot timing to move the whole column layout during drag", () => {
    const viewport = createTimelineViewport({ totalMs: 4_000, scale: 16 });
    const timings = [
      { stableShotId: "shot-a", startFrame: 0, endFrame: 20 },
      { stableShotId: "shot-b", startFrame: 30, endFrame: 70 },
      { stableShotId: "shot-c", startFrame: 90, endFrame: 120 },
    ];
    const entries = [
      { originalIndex: 0, stableShotId: "shot-a" },
      { originalIndex: 1, stableShotId: "shot-b" },
      { originalIndex: 2, stableShotId: "shot-c" },
    ];

    const preview = buildStoryboardMatrixLayout({
      entries,
      timings,
      previewTiming: {
        stableShotId: "shot-c",
        startFrame: 15,
        endFrame: 45,
      },
      pixelsPerFrame: framePx(viewport),
      targetWidth: viewport.contentWidth,
    });
    const restored = buildStoryboardMatrixLayout({
      entries,
      timings,
      previewTiming: null,
      pixelsPerFrame: framePx(viewport),
      targetWidth: viewport.contentWidth,
    });

    expect(preview.entries.map(entry => entry.stableShotId)).toEqual([
      "shot-a",
      "shot-c",
      "shot-b",
    ]);
    expect(restored.entries.map(entry => entry.stableShotId)).toEqual([
      "shot-a",
      "shot-b",
      "shot-c",
    ]);
    expect(timings[2]).toEqual({
      stableShotId: "shot-c",
      startFrame: 90,
      endFrame: 120,
    });
  });

  it("keeps frame-based starts when longer material expands the target width", () => {
    const viewport = createTimelineViewport({ totalMs: 120_000, scale: 16 });
    const layout = buildStoryboardMatrixLayout({
      entries: [
        { originalIndex: 0, stableShotId: "shot-a" },
        { originalIndex: 1, stableShotId: "shot-b" },
      ],
      timings: [
        { stableShotId: "shot-a", startFrame: 40, endFrame: 60 },
        { stableShotId: "shot-b", startFrame: 80, endFrame: 100 },
      ],
      pixelsPerFrame: framePx(viewport),
      targetWidth: viewport.contentWidth,
    });

    expect(viewport.contentWidth).toBe(1_920);
    expect(layout.leadingWidth).toBe(frameToPx(viewport, 40));
    expect(layout.widths).toEqual([
      frameToPx(viewport, 40),
      viewport.contentWidth - frameToPx(viewport, 80),
    ]);
    expect(layout.startOffsets).toEqual([
      frameToPx(viewport, 40),
      frameToPx(viewport, 80),
    ]);
  });

  it("does not let an older gesture clear a newer drag preview", () => {
    const firstGesture = Symbol("first");
    const secondGesture = Symbol("second");
    const first = updateStoryboardMatrixTimingPreview(
      null,
      { stableShotId: "shot-a", startFrame: 20, endFrame: 40 },
      firstGesture
    );
    const second = updateStoryboardMatrixTimingPreview(
      first,
      { stableShotId: "shot-b", startFrame: 50, endFrame: 80 },
      secondGesture
    );

    expect(
      updateStoryboardMatrixTimingPreview(second, null, firstGesture)
    ).toBe(second);
    expect(
      updateStoryboardMatrixTimingPreview(second, null, secondGesture)
    ).toBeNull();
  });

  it("expands a selected shot when its aligned column is too narrow to edit", () => {
    expect(shouldCompactStoryboardMatrixForShot(17, 196)).toBe(true);
    expect(shouldCompactStoryboardMatrixForShot(153, 196)).toBe(false);
  });
});
