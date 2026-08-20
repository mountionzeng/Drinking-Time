import type { PublishingAlbumPoint } from "../../../../shared/publishingAlbum";

export type PublishingAlbumStrokePoint = { x: number; y: number };

export type PublishingAlbumCanonicalGeometry =
  | {
      kind: "region";
      shape: "rectangle" | "ellipse";
      direction: "horizontal" | "vertical";
      region: { x: number; y: number; width: number; height: number };
      points: PublishingAlbumPoint[];
    }
  | { kind: "path"; points: PublishingAlbumPoint[] };

export type PublishingAlbumGeometryResult =
  | { status: "ok"; geometry: PublishingAlbumCanonicalGeometry }
  | { status: "invalid"; reason: "cancelled" | "out_of_bounds" | "too_short" | "self_intersection" | "no_area" };

function distance(left: PublishingAlbumPoint, right: PublishingAlbumPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function perpendicularDistance(point: PublishingAlbumPoint, start: PublishingAlbumPoint, end: PublishingAlbumPoint): number {
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (lengthSquared === 0) return distance(point, start);
  const t = Math.max(0, Math.min(1,
    ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / lengthSquared
  ));
  return distance(point, { x: start.x + t * (end.x - start.x), y: start.y + t * (end.y - start.y) });
}

function simplify(points: PublishingAlbumPoint[], tolerance = 0.004): PublishingAlbumPoint[] {
  if (points.length <= 2) return points;
  let farthest = 0;
  let index = 0;
  for (let candidate = 1; candidate < points.length - 1; candidate += 1) {
    const value = perpendicularDistance(points[candidate]!, points[0]!, points.at(-1)!);
    if (value > farthest) { farthest = value; index = candidate; }
  }
  if (farthest <= tolerance) return [points[0]!, points.at(-1)!];
  return [
    ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(index), tolerance),
  ];
}

function orientation(a: PublishingAlbumPoint, b: PublishingAlbumPoint, c: PublishingAlbumPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function intersects(a: PublishingAlbumPoint, b: PublishingAlbumPoint, c: PublishingAlbumPoint, d: PublishingAlbumPoint): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < -1e-10 && cdA * cdB < -1e-10;
}

function hasSelfIntersection(points: PublishingAlbumPoint[], closed: boolean): boolean {
  const segments = closed ? [...points, points[0]!] : points;
  for (let left = 0; left < segments.length - 1; left += 1) {
    for (let right = left + 2; right < segments.length - 1; right += 1) {
      if (closed && left === 0 && right === segments.length - 2) continue;
      if (intersects(segments[left]!, segments[left + 1]!, segments[right]!, segments[right + 1]!)) return true;
    }
  }
  return false;
}

function polygonArea(points: PublishingAlbumPoint[]): number {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

function rounded(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function classifyPublishingAlbumStroke(input: {
  points: PublishingAlbumStrokePoint[];
  width: number;
  height: number;
  cancelled?: boolean;
}): PublishingAlbumGeometryResult {
  if (input.cancelled) return { status: "invalid", reason: "cancelled" };
  if (!Number.isFinite(input.width) || !Number.isFinite(input.height) || input.width <= 0 || input.height <= 0) {
    return { status: "invalid", reason: "out_of_bounds" };
  }
  if (input.points.some(point =>
    !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
    point.x < 0 || point.y < 0 || point.x > input.width || point.y > input.height
  )) return { status: "invalid", reason: "out_of_bounds" };
  const normalized = input.points.map(point => ({
    x: rounded(point.x / input.width), y: rounded(point.y / input.height),
  })).filter((point, index, list) => index === 0 || distance(point, list[index - 1]!) >= 0.003);
  if (normalized.length < 2) return { status: "invalid", reason: "too_short" };
  const points = simplify(normalized);
  const length = points.slice(1).reduce((sum, point, index) => sum + distance(points[index]!, point), 0);
  if (length < 0.06) return { status: "invalid", reason: "too_short" };
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const width = maxX - minX; const height = maxY - minY;
  const diagonal = Math.hypot(width, height);
  const closed = points.length >= 4 && distance(points[0]!, points.at(-1)!) <= Math.max(0.035, diagonal * 0.16);
  if (hasSelfIntersection(points, closed)) return { status: "invalid", reason: "self_intersection" };
  if (!closed) return { status: "ok", geometry: { kind: "path", points } };
  const area = polygonArea(points);
  if (area < 0.004 || width < 0.04 || height < 0.04) return { status: "invalid", reason: "no_area" };
  const aspect = width / height;
  const shape = points.length >= 6 && aspect >= 0.6 && aspect <= 1.7 ? "ellipse" : "rectangle";
  return {
    status: "ok",
    geometry: {
      kind: "region",
      shape,
      direction: height > width * 1.25 ? "vertical" : "horizontal",
      region: { x: rounded(minX), y: rounded(minY), width: rounded(width), height: rounded(height) },
      points,
    },
  };
}

export function publishingAlbumSvgPath(points: PublishingAlbumPoint[], width: number, height: number): string {
  return points.map((point, index) =>
    `${index === 0 ? "M" : "L"}${rounded(point.x * width)} ${rounded(point.y * height)}`
  ).join(" ");
}
