import path from "node:path";
import { readdir, stat } from "node:fs/promises";
import { localImageDir } from "./imageGen";

const EXTRACTION_RATE_WINDOW_MS = 60_000;
const EXTRACTION_RATE_LIMIT = 60;
const EXTRACTION_CALL_RATE_LIMIT = 600;
const MAX_ACTIVE_CAPTURES_PER_USER = 2;
export const TIMELINE_EXTRACTION_USAGE_CACHE_TTL_MS = 60_000;
export const MAX_TIMELINE_EXTRACTION_STORAGE_BYTES = 10 * 1024 * 1024 * 1024;
export const MAX_TIMELINE_EXTRACTION_SOURCE_FILES = 20_000;
export const TIMELINE_EXTRACTION_STORAGE_QUOTA_MESSAGE =
  "抽帧仓库空间已满，请清理后重试";

type ExtractionRateBucket = {
  requestTimes: number[];
  lastSeenAt: number;
};

const extractionRateBuckets = new Map<number, ExtractionRateBucket>();
const extractionCallRateBuckets = new Map<number, ExtractionRateBucket>();
const inFlightCaptures = new Map<string, Promise<unknown>>();
const activeCaptureCountByUser = new Map<number, number>();
let rateLimitMaintenanceCount = 0;
let callRateLimitMaintenanceCount = 0;
let extractionStorageQueue: Promise<void> = Promise.resolve();

export type TimelineFrameExtractionUsageSnapshot = {
  totalBytes: number;
  fileCount: number;
  fileSizes: Map<string, number>;
};

type ExtractionStorageUsageCacheEntry = {
  scannedAt: number;
  usage: TimelineFrameExtractionUsageSnapshot;
};

const extractionStorageUsageCache = new Map<
  string,
  ExtractionStorageUsageCacheEntry
>();

export class TimelineFrameExtractionStorageQuotaError extends Error {
  constructor() {
    super(TIMELINE_EXTRACTION_STORAGE_QUOTA_MESSAGE);
    this.name = "TimelineFrameExtractionStorageQuotaError";
  }
}

async function scanExtractionStorageUsage(
  directory: string
): Promise<TimelineFrameExtractionUsageSnapshot> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        totalBytes: 0,
        fileCount: 0,
        fileSizes: new Map(),
      };
    }
    throw error;
  }

  const candidates = entries.filter(
    entry => entry.isFile() && /^source-[a-zA-Z0-9_-]+\.png$/.test(entry.name)
  );
  const fileSizes = new Map<string, number>();
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(32, candidates.length) },
    async () => {
      while (cursor < candidates.length) {
        const entry = candidates[cursor];
        cursor += 1;
        try {
          const size = (await stat(path.join(directory, entry.name))).size;
          fileSizes.set(entry.name, size);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
  );
  await Promise.all(workers);
  return {
    totalBytes: [...fileSizes.values()].reduce((sum, size) => sum + size, 0),
    fileCount: fileSizes.size,
    fileSizes,
  };
}

export type TimelineFrameExtractionUsageScanner = (
  directory: string
) => Promise<TimelineFrameExtractionUsageSnapshot>;

async function cachedExtractionStorageUsage(input: {
  directory: string;
  now: number;
  scanUsage: TimelineFrameExtractionUsageScanner;
}): Promise<TimelineFrameExtractionUsageSnapshot> {
  const cacheKey = path.resolve(input.directory);
  const cached = extractionStorageUsageCache.get(cacheKey);
  const cacheAge = cached ? input.now - cached.scannedAt : null;
  if (
    cached &&
    cacheAge != null &&
    cacheAge >= 0 &&
    cacheAge < TIMELINE_EXTRACTION_USAGE_CACHE_TTL_MS
  ) {
    return cached.usage;
  }
  const usage = await input.scanUsage(input.directory);
  extractionStorageUsageCache.set(cacheKey, {
    scannedAt: input.now,
    usage,
  });
  return usage;
}

async function withExtractionStorageQueue<T>(
  work: () => Promise<T>
): Promise<T> {
  const previous = extractionStorageQueue;
  let release!: () => void;
  extractionStorageQueue = new Promise<void>(resolve => {
    release = resolve;
  });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

function extractionTargetFileName(storageKey: string): string {
  const targetFileName = path.posix.basename(storageKey);
  if (!/^source-[a-zA-Z0-9_-]+\.png$/.test(targetFileName)) {
    throw new Error("抽帧存储标识无效");
  }
  return targetFileName;
}

/** Reject a known-new source before paying the cost of decoding its frame. */
export async function preflightTimelineFrameExtractionStorage(input: {
  storageKey: string;
  directory?: string;
  maxBytes?: number;
  maxFiles?: number;
  now?: number;
  scanUsage?: TimelineFrameExtractionUsageScanner;
}): Promise<void> {
  const targetFileName = extractionTargetFileName(input.storageKey);
  const directory = input.directory ?? localImageDir();
  await withExtractionStorageQueue(async () => {
    const usage = await cachedExtractionStorageUsage({
      directory,
      now: input.now ?? Date.now(),
      scanUsage: input.scanUsage ?? scanExtractionStorageUsage,
    });
    if (
      !usage.fileSizes.has(targetFileName) &&
      (usage.totalBytes >=
        (input.maxBytes ?? MAX_TIMELINE_EXTRACTION_STORAGE_BYTES) ||
        usage.fileCount >=
          (input.maxFiles ?? MAX_TIMELINE_EXTRACTION_SOURCE_FILES))
    ) {
      throw new TimelineFrameExtractionStorageQuotaError();
    }
  });
}

/**
 * Keep extraction PNG usage bounded independently of Story/receipt rows.
 * The files deliberately outlive those rows, so the directory is the durable
 * source of truth. Checks and writes are serialized within this process.
 */
export async function storeTimelineFrameExtractionBytes<T>(input: {
  bytes: Uint8Array;
  storageKey: string;
  store: () => Promise<T>;
  directory?: string;
  maxBytes?: number;
  maxFiles?: number;
  now?: number;
  scanUsage?: TimelineFrameExtractionUsageScanner;
}): Promise<T> {
  const targetFileName = extractionTargetFileName(input.storageKey);
  const directory = input.directory ?? localImageDir();
  return withExtractionStorageQueue(async () => {
    const usage = await cachedExtractionStorageUsage({
      directory,
      now: input.now ?? Date.now(),
      scanUsage: input.scanUsage ?? scanExtractionStorageUsage,
    });
    const replacedBytes = usage.fileSizes.get(targetFileName) ?? 0;
    const targetExists = usage.fileSizes.has(targetFileName);
    const projectedBytes =
      usage.totalBytes - replacedBytes + input.bytes.byteLength;
    const projectedFiles = usage.fileCount + (targetExists ? 0 : 1);
    if (
      projectedBytes >
        (input.maxBytes ?? MAX_TIMELINE_EXTRACTION_STORAGE_BYTES) ||
      projectedFiles > (input.maxFiles ?? MAX_TIMELINE_EXTRACTION_SOURCE_FILES)
    ) {
      throw new TimelineFrameExtractionStorageQuotaError();
    }
    const stored = await input.store();
    usage.totalBytes = projectedBytes;
    usage.fileCount = projectedFiles;
    usage.fileSizes.set(targetFileName, input.bytes.byteLength);
    return stored;
  });
}

export type TimelineFrameExtractionAllowance =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Limit runnable extraction attempts. Receipt replay and active polling skip
 * this function at the workflow layer, while an expired/released claim is
 * charged again so one request id cannot create an unbounded retry loop.
 */
export function consumeTimelineFrameExtractionAllowance(input: {
  userId: number;
  storyId: number;
  requestId: string;
  now?: number;
}): TimelineFrameExtractionAllowance {
  const now = input.now ?? Date.now();
  const cutoff = now - EXTRACTION_RATE_WINDOW_MS;
  rateLimitMaintenanceCount += 1;
  if (rateLimitMaintenanceCount % 64 === 0) {
    for (const [userId, candidate] of extractionRateBuckets) {
      if (candidate.lastSeenAt <= cutoff) extractionRateBuckets.delete(userId);
    }
  }
  const bucket = extractionRateBuckets.get(input.userId) ?? {
    requestTimes: [],
    lastSeenAt: now,
  };
  bucket.requestTimes = bucket.requestTimes.filter(time => time > cutoff);
  bucket.lastSeenAt = now;
  extractionRateBuckets.set(input.userId, bucket);

  if (bucket.requestTimes.length >= EXTRACTION_RATE_LIMIT) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(
          (bucket.requestTimes[0] + EXTRACTION_RATE_WINDOW_MS - now) / 1_000
        )
      ),
    };
  }

  bucket.requestTimes.push(now);
  return { allowed: true };
}

/** Loose endpoint guard, including active-claim polling and durable replay. */
export function consumeTimelineFrameExtractionCallAllowance(input: {
  userId: number;
  now?: number;
}): TimelineFrameExtractionAllowance {
  const now = input.now ?? Date.now();
  const cutoff = now - EXTRACTION_RATE_WINDOW_MS;
  callRateLimitMaintenanceCount += 1;
  if (callRateLimitMaintenanceCount % 64 === 0) {
    for (const [userId, candidate] of extractionCallRateBuckets) {
      if (candidate.lastSeenAt <= cutoff) {
        extractionCallRateBuckets.delete(userId);
      }
    }
  }
  const bucket = extractionCallRateBuckets.get(input.userId) ?? {
    requestTimes: [],
    lastSeenAt: now,
  };
  bucket.requestTimes = bucket.requestTimes.filter(time => time > cutoff);
  bucket.lastSeenAt = now;
  extractionCallRateBuckets.set(input.userId, bucket);
  if (bucket.requestTimes.length >= EXTRACTION_CALL_RATE_LIMIT) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(
          (bucket.requestTimes[0] + EXTRACTION_RATE_WINDOW_MS - now) / 1_000
        )
      ),
    };
  }
  bucket.requestTimes.push(now);
  return { allowed: true };
}

export class TimelineFrameCaptureBusyError extends Error {
  constructor() {
    super("同一用户同时抽帧过多");
    this.name = "TimelineFrameCaptureBusyError";
  }
}

/** Single-flight identical frame decodes and cap distinct ffmpeg work per user. */
export async function runTimelineFrameCapture<T>(input: {
  userId: number;
  takeId: number;
  rangeId: number | null;
  atSec: number;
  capture: () => Promise<T>;
}): Promise<T> {
  const key = `${input.userId}:${input.takeId}:${input.rangeId ?? "full"}:${input.atSec.toFixed(3)}`;
  const existing = inFlightCaptures.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const active = activeCaptureCountByUser.get(input.userId) ?? 0;
  if (active >= MAX_ACTIVE_CAPTURES_PER_USER) {
    throw new TimelineFrameCaptureBusyError();
  }

  activeCaptureCountByUser.set(input.userId, active + 1);
  let pending: Promise<T>;
  try {
    pending = Promise.resolve(input.capture());
  } catch (error) {
    const remaining = (activeCaptureCountByUser.get(input.userId) ?? 1) - 1;
    if (remaining > 0) activeCaptureCountByUser.set(input.userId, remaining);
    else activeCaptureCountByUser.delete(input.userId);
    throw error;
  }
  inFlightCaptures.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlightCaptures.get(key) === pending) inFlightCaptures.delete(key);
    const remaining = (activeCaptureCountByUser.get(input.userId) ?? 1) - 1;
    if (remaining > 0) activeCaptureCountByUser.set(input.userId, remaining);
    else activeCaptureCountByUser.delete(input.userId);
  }
}

export function resetTimelineFrameExtractionLimitsForTesting(): void {
  extractionRateBuckets.clear();
  extractionCallRateBuckets.clear();
  inFlightCaptures.clear();
  activeCaptureCountByUser.clear();
  rateLimitMaintenanceCount = 0;
  callRateLimitMaintenanceCount = 0;
  extractionStorageQueue = Promise.resolve();
  extractionStorageUsageCache.clear();
}
