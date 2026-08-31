import type { TimelineTransform } from "@shared/storyMaterial";

export type PreviewImageGeometry = {
  previewWidth: number;
  previewHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  transform?: TimelineTransform | null;
};

const finite = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) ? (value as number) : fallback;

export function previewPointToSourcePoint(
  geometry: PreviewImageGeometry,
  point: { x: number; y: number }
): { x: number; y: number } | null {
  const { previewWidth, previewHeight, sourceWidth, sourceHeight } = geometry;
  if (
    previewWidth <= 0 ||
    previewHeight <= 0 ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  ) return null;

  const transform = geometry.transform;
  const centerX = previewWidth / 2;
  const centerY = previewHeight / 2;
  const panX = Math.max(-1, Math.min(1, finite(transform?.panX, 0)));
  const panY = Math.max(-1, Math.min(1, finite(transform?.panY, 0)));
  const zoom = Math.max(0.25, Math.min(8, finite(transform?.zoom, 1)));
  const rotation = finite(transform?.rotationDeg, 0) * Math.PI / 180;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);

  const translatedX = point.x - centerX - panX * previewWidth * 0.5;
  const translatedY = point.y - centerY - panY * previewHeight * 0.5;
  const rotatedX = translatedX * cos - translatedY * sin;
  const rotatedY = translatedX * sin + translatedY * cos;
  const baseX = centerX + rotatedX / (zoom * (transform?.flipX ? -1 : 1));
  const baseY = centerY + rotatedY / (zoom * (transform?.flipY ? -1 : 1));

  const coverScale = Math.max(previewWidth / sourceWidth, previewHeight / sourceHeight);
  const drawnWidth = sourceWidth * coverScale;
  const drawnHeight = sourceHeight * coverScale;
  const sourceX = (baseX - (previewWidth - drawnWidth) / 2) / coverScale;
  const sourceY = (baseY - (previewHeight - drawnHeight) / 2) / coverScale;
  if (
    sourceX < 0 ||
    sourceY < 0 ||
    sourceX >= sourceWidth ||
    sourceY >= sourceHeight
  ) return null;
  return { x: sourceX, y: sourceY };
}

export function previewRectToSourceRect(
  geometry: PreviewImageGeometry,
  rect: { start: { x: number; y: number }; end: { x: number; y: number } }
): { left: number; top: number; right: number; bottom: number } | null {
  const previewLeft = Math.min(rect.start.x, rect.end.x);
  const previewTop = Math.min(rect.start.y, rect.end.y);
  const previewRight = Math.max(rect.start.x, rect.end.x);
  const previewBottom = Math.max(rect.start.y, rect.end.y);
  const corners = [
    { x: previewLeft, y: previewTop },
    { x: previewRight, y: previewTop },
    { x: previewRight, y: previewBottom },
    { x: previewLeft, y: previewBottom },
  ].map(point => previewPointToSourcePoint(geometry, point));
  if (corners.some(point => point == null)) return null;
  const points = corners as Array<{ x: number; y: number }>;
  return {
    left: Math.min(...points.map(point => point.x)),
    top: Math.min(...points.map(point => point.y)),
    right: Math.max(...points.map(point => point.x)),
    bottom: Math.max(...points.map(point => point.y)),
  };
}

function polygonArea(points: Array<{ x: number; y: number }>): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea) / 2;
}

/** Map a freehand Preview lasso through the same cover/transform inverse as
 * point selection. The source polygon is only a search constraint; the
 * server still requires a semantic object mask before it can be edited. */
export function previewPathToSourcePolygon(
  geometry: PreviewImageGeometry,
  path: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> | null {
  if (path.length < 3 || path.length > 512) return null;
  const mapped = path.map(point => previewPointToSourcePoint(geometry, point));
  if (mapped.some(point => point == null)) return null;
  const polygon = mapped as Array<{ x: number; y: number }>;
  return polygonArea(polygon) >= 16 ? polygon : null;
}

export function sourcePointToPreviewPoint(
  geometry: PreviewImageGeometry,
  point: { x: number; y: number }
): { x: number; y: number } | null {
  const { previewWidth, previewHeight, sourceWidth, sourceHeight } = geometry;
  if (
    previewWidth <= 0 || previewHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0
  ) return null;
  const transform = geometry.transform;
  const coverScale = Math.max(previewWidth / sourceWidth, previewHeight / sourceHeight);
  const baseX = (previewWidth - sourceWidth * coverScale) / 2 + point.x * coverScale;
  const baseY = (previewHeight - sourceHeight * coverScale) / 2 + point.y * coverScale;
  const centerX = previewWidth / 2;
  const centerY = previewHeight / 2;
  const zoom = Math.max(0.25, Math.min(8, finite(transform?.zoom, 1)));
  const localX = (baseX - centerX) * zoom * (transform?.flipX ? -1 : 1);
  const localY = (baseY - centerY) * zoom * (transform?.flipY ? -1 : 1);
  const rotation = finite(transform?.rotationDeg, 0) * Math.PI / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: centerX + localX * cos - localY * sin + finite(transform?.panX, 0) * previewWidth * 0.5,
    y: centerY + localX * sin + localY * cos + finite(transform?.panY, 0) * previewHeight * 0.5,
  };
}
