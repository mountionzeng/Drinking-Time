import type { SegmentationResult } from "./segmentation";

const CACHE_TTL_MS = 15_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
const PER_IMAGE_CONCURRENCY = 2;

type Cached = { expiresAt: number; result: SegmentationResult };

const inFlight = new Map<string, Promise<SegmentationResult>>();
const cached = new Map<string, Cached>();
const userAttempts = new Map<number, number[]>();
const imageConcurrency = new Map<string, number>();

export function resetSegmentationRequestGuardForTesting(): void {
  inFlight.clear();
  cached.clear();
  userAttempts.clear();
  imageConcurrency.clear();
}

function registerAttempt(userId: number, now: number): boolean {
  const recent = (userAttempts.get(userId) ?? []).filter(
    timestamp => timestamp > now - RATE_WINDOW_MS
  );
  if (recent.length >= RATE_LIMIT) {
    userAttempts.set(userId, recent);
    return false;
  }
  recent.push(now);
  userAttempts.set(userId, recent);
  return true;
}

export async function runSponsoredSegmentation(input: {
  userId: number;
  storyId: number;
  imageId: number;
  x: number;
  y: number;
  task: () => Promise<SegmentationResult>;
  now?: number;
}): Promise<SegmentationResult> {
  const now = input.now ?? Date.now();
  const pointKey = `${input.userId}:${input.storyId}:${input.imageId}:${Math.round(input.x / 4)}:${Math.round(input.y / 4)}`;
  const imageKey = `${input.userId}:${input.storyId}:${input.imageId}`;
  const hit = cached.get(pointKey);
  if (hit && hit.expiresAt > now) return hit.result;
  const existing = inFlight.get(pointKey);
  if (existing) return existing;
  if (!registerAttempt(input.userId, now)) {
    return { status: "error", message: "点选过于频繁，请稍后再试" };
  }
  const concurrent = imageConcurrency.get(imageKey) ?? 0;
  if (concurrent >= PER_IMAGE_CONCURRENCY) {
    return { status: "error", message: "这张图正在识别其他位置，请稍候" };
  }
  imageConcurrency.set(imageKey, concurrent + 1);
  const promise = input.task().then(result => {
    if (result.status === "ok") {
      cached.set(pointKey, { expiresAt: Date.now() + CACHE_TTL_MS, result });
    }
    return result;
  }).finally(() => {
    inFlight.delete(pointKey);
    const next = Math.max(0, (imageConcurrency.get(imageKey) ?? 1) - 1);
    if (next === 0) imageConcurrency.delete(imageKey);
    else imageConcurrency.set(imageKey, next);
  });
  inFlight.set(pointKey, promise);
  return promise;
}
