import { describe, expect, it } from "vitest";
import { framePx, msToPx, pxToMs } from "@shared/timelineViewport";
import { storyboardZoomViewport, storyboardZoomForScale } from "./StoryboardTimelineRuler";

describe("storyboard zoom", () => {
  it("fits the entire film exactly in narrow and wide panels", () => {
    for (const total of [1000 / 30, 10000, 600000]) {
      for (const width of [240, 720, 1400]) {
        const viewport = storyboardZoomViewport(total, width, 0);
        expect(viewport.contentWidth).toBeCloseTo(width);
        expect(msToPx(viewport, total)).toBeCloseTo(width);
      }
    }
  });
  it("gives a single frame an information column at maximum zoom", () => {
    const viewport = storyboardZoomViewport(60000, 720, 100);
    expect(framePx(viewport)).toBeCloseTo(248);
    expect(pxToMs(viewport, msToPx(viewport, 1234))).toBeCloseTo(1234);
  });
  it("keeps intermediate zoom monotonic and empty timelines finite", () => {
    const widths = [0, 25, 50, 75, 100].map(zoom => storyboardZoomViewport(60000, 720, zoom).contentWidth);
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    expect(Number.isFinite(storyboardZoomViewport(0, 0, 100).scale)).toBe(true);
  });
});

it("round-trips gesture scale through the existing logarithmic zoom slider", () => {
  for (const total of [0, 1000/30, 68000, 600000]) for (const width of [240,720,1400]) {
    for (const zoom of [0,0.25,12.5,50,100]) {
      const viewport = storyboardZoomViewport(total,width,zoom);
      const restored = storyboardZoomViewport(total,width,storyboardZoomForScale(total,width,viewport.scale));
      expect(restored.scale).toBeCloseTo(viewport.scale);
    }
  }
  expect(storyboardZoomForScale(68000,500,NaN)).toBe(0);
});
