import { describe, expect, it } from "vitest";

import {
  previewPathToSourcePolygon,
  previewPointToSourcePoint,
  previewRectToSourceRect,
  sourcePointToPreviewPoint,
  type PreviewImageGeometry,
} from "./previewObjectMaskGeometry";

const base: PreviewImageGeometry = {
  previewWidth: 100,
  previewHeight: 100,
  sourceWidth: 200,
  sourceHeight: 100,
};

describe("preview object mask geometry", () => {
  it("maps the object-cover center back to source center", () => {
    expect(previewPointToSourcePoint(base, { x: 50, y: 50 })).toEqual({ x: 100, y: 50 });
  });

  it("round trips pan, zoom, rotation and flips", () => {
    const transforms = [
      { zoom: 2, panX: 0.25, panY: -0.2, rotationDeg: 0 },
      { zoom: 1.25, panX: 0, panY: 0, rotationDeg: 90 },
      { zoom: 1, panX: 0, panY: 0, rotationDeg: 180, flipX: true },
      { zoom: 1.4, panX: -0.1, panY: 0.1, rotationDeg: -35, flipY: true },
    ];
    for (const transform of transforms) {
      const geometry = { ...base, transform: transform as any };
      const preview = sourcePointToPreviewPoint(geometry, { x: 100, y: 50 });
      expect(preview).not.toBeNull();
      const source = previewPointToSourcePoint(geometry, preview!);
      expect(source?.x).toBeCloseTo(100, 5);
      expect(source?.y).toBeCloseTo(50, 5);
    }
  });

  it("rejects points outside transformed image content", () => {
    const zoomedOut = { ...base, transform: { zoom: 0.5 } as any };
    expect(previewPointToSourcePoint(zoomedOut, { x: 0, y: 0 })).toBeNull();
  });

  it("maps a dragged Preview rectangle into a bounded source rectangle", () => {
    expect(previewRectToSourceRect(base, {
      start: { x: 25, y: 25 },
      end: { x: 75, y: 75 },
    })).toEqual({ left: 75, top: 25, right: 125, bottom: 75 });
  });

  it("rejects a drag whose corners do not both land on image content", () => {
    const zoomedOut = { ...base, transform: { zoom: 0.5 } as any };
    expect(previewRectToSourceRect(zoomedOut, {
      start: { x: 0, y: 0 },
      end: { x: 60, y: 60 },
    })).toBeNull();
  });

  it("maps a closed Preview lasso into source-image polygon coordinates", () => {
    expect(previewPathToSourcePolygon(base, [
      { x: 25, y: 25 },
      { x: 75, y: 25 },
      { x: 75, y: 75 },
      { x: 25, y: 75 },
    ])).toEqual([
      { x: 75, y: 25 },
      { x: 125, y: 25 },
      { x: 125, y: 75 },
      { x: 75, y: 75 },
    ]);
  });

  it("rejects a lasso that is too small or leaves transformed image content", () => {
    expect(previewPathToSourcePolygon(base, [
      { x: 50, y: 50 },
      { x: 51, y: 50 },
      { x: 50, y: 51 },
    ])).toBeNull();
    const zoomedOut = { ...base, transform: { zoom: 0.5 } as any };
    expect(previewPathToSourcePolygon(zoomedOut, [
      { x: 0, y: 0 },
      { x: 80, y: 20 },
      { x: 70, y: 70 },
    ])).toBeNull();
  });
});
