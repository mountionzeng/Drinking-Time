import { describe, expect, it } from "vitest";

import {
  buildStoryboardMatrixLayout,
  shouldCompactStoryboardMatrixForShot,
} from "./storyboardMatrixLayout";

describe("storyboard matrix timeline layout", () => {
  it("orders columns by timeline start and makes every column start match its edit block", () => {
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
      targetWidth: 1_200,
    });

    expect(layout.entries.map(entry => entry.stableShotId)).toEqual([
      "shot-a",
      "shot-b",
      "shot-c",
    ]);
    expect(layout.widths).toEqual([300, 600, 300]);
    expect(layout.startOffsets).toEqual([0, 300, 900]);
  });

  it("keeps shots missing from the timeline editable at the end", () => {
    const layout = buildStoryboardMatrixLayout({
      entries: [
        { originalIndex: 0, stableShotId: "draft" },
        { originalIndex: 1, stableShotId: "shot-a" },
      ],
      timings: [{ stableShotId: "shot-a", startFrame: 0, endFrame: 60 }],
      targetWidth: 600,
      unplacedWidth: 72,
    });

    expect(layout.entries.map(entry => entry.stableShotId)).toEqual([
      "shot-a",
      "draft",
    ]);
    expect(layout.widths).toEqual([600, 72]);
  });

  it("expands a selected shot when its aligned column is too narrow to edit", () => {
    expect(shouldCompactStoryboardMatrixForShot(17, 196)).toBe(true);
    expect(shouldCompactStoryboardMatrixForShot(153, 196)).toBe(false);
  });
});
