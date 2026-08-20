import { describe, expect, it } from "vitest";

import { classifyPublishingAlbumStroke, publishingAlbumSvgPath } from "./publishingAlbumGeometry";

const scale = (points: Array<{ x: number; y: number }>, factor: number) =>
  points.map(point => ({ x: point.x * factor, y: point.y * factor }));

describe("publishing album geometry", () => {
  it("classifies near-closed round and rectangular strokes as regions", () => {
    const circle = classifyPublishingAlbumStroke({
      width: 100, height: 100,
      points: [
        { x: 50, y: 10 }, { x: 80, y: 20 }, { x: 92, y: 50 },
        { x: 80, y: 82 }, { x: 50, y: 92 }, { x: 18, y: 80 },
        { x: 8, y: 50 }, { x: 20, y: 18 }, { x: 48, y: 11 },
      ],
    });
    const rectangle = classifyPublishingAlbumStroke({
      width: 200, height: 100,
      points: [
        { x: 20, y: 20 }, { x: 180, y: 20 }, { x: 180, y: 80 },
        { x: 20, y: 80 }, { x: 21, y: 21 },
      ],
    });
    expect(circle).toMatchObject({ status: "ok", geometry: { kind: "region", shape: "ellipse" } });
    expect(rectangle).toMatchObject({ status: "ok", geometry: { kind: "region", direction: "horizontal" } });
  });

  it("classifies lines and arcs as paths and preserves direction", () => {
    const forward = classifyPublishingAlbumStroke({
      width: 100, height: 100,
      points: [{ x: 10, y: 80 }, { x: 35, y: 40 }, { x: 70, y: 20 }, { x: 90, y: 30 }],
    });
    const reverse = classifyPublishingAlbumStroke({
      width: 100, height: 100,
      points: [{ x: 90, y: 30 }, { x: 70, y: 20 }, { x: 35, y: 40 }, { x: 10, y: 80 }],
    });
    expect(forward).toMatchObject({ status: "ok", geometry: { kind: "path" } });
    expect(reverse).toMatchObject({ status: "ok", geometry: { kind: "path" } });
    if (forward.status === "ok" && reverse.status === "ok") {
      expect(forward.geometry.points[0]).toEqual(reverse.geometry.points.at(-1));
      expect(publishingAlbumSvgPath(forward.geometry.points, 100, 100)).toMatch(/^M10 80/);
      expect(publishingAlbumSvgPath(reverse.geometry.points, 100, 100)).toMatch(/^M90 30/);
    }
  });

  it("produces identical canonical geometry when the container scales", () => {
    const points = [{ x: 10, y: 20 }, { x: 40, y: 30 }, { x: 80, y: 70 }];
    const small = classifyPublishingAlbumStroke({ points, width: 100, height: 100 });
    const large = classifyPublishingAlbumStroke({ points: scale(points, 4), width: 400, height: 400 });
    expect(large).toEqual(small);
  });

  it("rejects jitter, cancellation, out-of-bounds and self-intersection", () => {
    expect(classifyPublishingAlbumStroke({
      width: 100, height: 100, points: [{ x: 20, y: 20 }, { x: 20.1, y: 20.1 }],
    })).toEqual({ status: "invalid", reason: "too_short" });
    expect(classifyPublishingAlbumStroke({
      width: 100, height: 100, cancelled: true, points: [{ x: 0, y: 0 }, { x: 50, y: 50 }],
    })).toEqual({ status: "invalid", reason: "cancelled" });
    expect(classifyPublishingAlbumStroke({
      width: 100, height: 100, points: [{ x: -1, y: 0 }, { x: 50, y: 50 }],
    })).toEqual({ status: "invalid", reason: "out_of_bounds" });
    expect(classifyPublishingAlbumStroke({
      width: 100, height: 100,
      points: [{ x: 10, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }, { x: 90, y: 10 }, { x: 11, y: 11 }],
    })).toEqual({ status: "invalid", reason: "self_intersection" });
  });
});
