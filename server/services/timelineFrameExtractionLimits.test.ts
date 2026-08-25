import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  consumeTimelineFrameExtractionAllowance,
  consumeTimelineFrameExtractionCallAllowance,
  preflightTimelineFrameExtractionStorage,
  resetTimelineFrameExtractionLimitsForTesting,
  runTimelineFrameCapture,
  TimelineFrameCaptureBusyError,
  storeTimelineFrameExtractionBytes,
  TimelineFrameExtractionStorageQuotaError,
  TIMELINE_EXTRACTION_USAGE_CACHE_TTL_MS,
} from "./timelineFrameExtractionLimits";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("timeline frame extraction resource limits", () => {
  beforeEach(() => resetTimelineFrameExtractionLimitsForTesting());

  it("charges every runnable attempt inside the rate window", () => {
    for (let index = 0; index < 60; index += 1) {
      expect(
        consumeTimelineFrameExtractionAllowance({
          userId: 7,
          storyId: 8,
          requestId: `request-${index}`,
          now: index,
        })
      ).toEqual({ allowed: true });
    }

    expect(
      consumeTimelineFrameExtractionAllowance({
        userId: 7,
        storyId: 8,
        requestId: "request-0",
        now: 1_000,
      })
    ).toEqual({ allowed: false, retryAfterSeconds: 59 });
    expect(
      consumeTimelineFrameExtractionAllowance({
        userId: 7,
        storyId: 8,
        requestId: "request-over-limit",
        now: 1_000,
      })
    ).toEqual({ allowed: false, retryAfterSeconds: 59 });
  });

  it("bounds active-claim polling and replay calls", () => {
    for (let index = 0; index < 600; index += 1) {
      expect(
        consumeTimelineFrameExtractionCallAllowance({ userId: 7, now: index })
      ).toEqual({ allowed: true });
    }
    expect(
      consumeTimelineFrameExtractionCallAllowance({ userId: 7, now: 1_000 })
    ).toEqual({ allowed: false, retryAfterSeconds: 59 });
  });

  it("rejects a new source when the file-count boundary is full", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "timeline-extraction-count-")
    );
    try {
      await writeFile(
        path.join(directory, "source-existing.png"),
        new Uint8Array(1)
      );
      await expect(
        preflightTimelineFrameExtractionStorage({
          storageKey: "generated/timeline-extractions/source-next.png",
          directory,
          maxBytes: 100,
          maxFiles: 1,
        })
      ).rejects.toBeInstanceOf(TimelineFrameExtractionStorageQuotaError);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("single-flights the same authoritative frame", async () => {
    const frame = deferred<{ path: string }>();
    const capture = vi.fn(() => frame.promise);
    const input = {
      userId: 7,
      takeId: 11,
      rangeId: 3,
      atSec: 1.25,
      capture,
    };

    const first = runTimelineFrameCapture(input);
    const second = runTimelineFrameCapture(input);
    expect(capture).toHaveBeenCalledTimes(1);

    frame.resolve({ path: "/tmp/frame.png" });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { path: "/tmp/frame.png" },
      { path: "/tmp/frame.png" },
    ]);
  });

  it("caps distinct active captures per user and releases slots", async () => {
    const firstFrame = deferred<string>();
    const secondFrame = deferred<string>();
    const first = runTimelineFrameCapture({
      userId: 7,
      takeId: 11,
      rangeId: null,
      atSec: 0.1,
      capture: () => firstFrame.promise,
    });
    const second = runTimelineFrameCapture({
      userId: 7,
      takeId: 12,
      rangeId: null,
      atSec: 0.2,
      capture: () => secondFrame.promise,
    });

    await expect(
      runTimelineFrameCapture({
        userId: 7,
        takeId: 13,
        rangeId: null,
        atSec: 0.3,
        capture: vi.fn(),
      })
    ).rejects.toBeInstanceOf(TimelineFrameCaptureBusyError);

    firstFrame.resolve("first");
    await expect(first).resolves.toBe("first");
    const third = runTimelineFrameCapture({
      userId: 7,
      takeId: 13,
      rangeId: null,
      atSec: 0.3,
      capture: async () => "third",
    });
    await expect(third).resolves.toBe("third");
    secondFrame.resolve("second");
    await expect(second).resolves.toBe("second");
  });

  it("releases the slot when capture throws before returning a promise", async () => {
    await expect(
      runTimelineFrameCapture({
        userId: 7,
        takeId: 11,
        rangeId: null,
        atSec: 0.1,
        capture: () => {
          throw new Error("ffmpeg spawn failed");
        },
      })
    ).rejects.toThrow("ffmpeg spawn failed");

    await expect(
      runTimelineFrameCapture({
        userId: 7,
        takeId: 12,
        rangeId: null,
        atSec: 0.2,
        capture: async () => "recovered",
      })
    ).resolves.toBe("recovered");
  });

  it("allows the exact storage boundary and rejects one byte beyond it", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "timeline-extraction-quota-")
    );
    try {
      await writeFile(
        path.join(directory, "source-existing.png"),
        new Uint8Array(6)
      );
      const atBoundary = vi.fn(async () => "stored");
      await expect(
        storeTimelineFrameExtractionBytes({
          bytes: new Uint8Array(4),
          storageKey: "generated/timeline-extractions/source-new.png",
          directory,
          maxBytes: 10,
          store: atBoundary,
        })
      ).resolves.toBe("stored");
      expect(atBoundary).toHaveBeenCalledOnce();

      const overBoundary = vi.fn(async () => "must-not-store");
      await expect(
        storeTimelineFrameExtractionBytes({
          bytes: new Uint8Array(5),
          storageKey: "generated/timeline-extractions/source-new.png",
          directory,
          maxBytes: 10,
          store: overBoundary,
        })
      ).rejects.toBeInstanceOf(TimelineFrameExtractionStorageQuotaError);
      expect(overBoundary).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("subtracts the old deterministic target size when overwriting", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "timeline-extraction-overwrite-")
    );
    try {
      await writeFile(
        path.join(directory, "source-same.png"),
        new Uint8Array(7)
      );
      const store = vi.fn(async () => "replaced");
      await expect(
        storeTimelineFrameExtractionBytes({
          bytes: new Uint8Array(8),
          storageKey: "generated/timeline-extractions/source-same.png",
          directory,
          maxBytes: 8,
          store,
        })
      ).resolves.toBe("replaced");
      expect(store).toHaveBeenCalledOnce();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("counts orphaned source files even after their Story receipt is gone", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "timeline-extraction-orphan-")
    );
    try {
      // No database fixture exists: this models a Story cascade deleting its
      // receipt while the intentionally durable warehouse PNG remains.
      await writeFile(
        path.join(directory, "source-orphan.png"),
        new Uint8Array(10)
      );
      const store = vi.fn(async () => "must-not-store");
      await expect(
        storeTimelineFrameExtractionBytes({
          bytes: new Uint8Array(1),
          storageKey: "generated/timeline-extractions/source-next.png",
          directory,
          maxBytes: 10,
          store,
        })
      ).rejects.toBeInstanceOf(TimelineFrameExtractionStorageQuotaError);
      expect(store).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("scans once and updates cached usage after successful new writes and overwrites", async () => {
    const directory = "/virtual/timeline-extraction-cache";
    const scanUsage = vi.fn(async () => ({
      totalBytes: 0,
      fileCount: 0,
      fileSizes: new Map<string, number>(),
    }));

    await storeTimelineFrameExtractionBytes({
      bytes: new Uint8Array(6),
      storageKey: "generated/timeline-extractions/source-same.png",
      directory,
      maxBytes: 10,
      scanUsage,
      store: async () => "first",
    });
    await expect(
      storeTimelineFrameExtractionBytes({
        bytes: new Uint8Array(8),
        storageKey: "generated/timeline-extractions/source-same.png",
        directory,
        maxBytes: 10,
        scanUsage,
        store: async () => "overwritten",
      })
    ).resolves.toBe("overwritten");
    await expect(
      storeTimelineFrameExtractionBytes({
        bytes: new Uint8Array(3),
        storageKey: "generated/timeline-extractions/source-new.png",
        directory,
        maxBytes: 10,
        scanUsage,
        store: async () => "must-not-store",
      })
    ).rejects.toBeInstanceOf(TimelineFrameExtractionStorageQuotaError);

    expect(scanUsage).toHaveBeenCalledTimes(1);
  });

  it("refreshes stale usage and reset clears the directory cache", async () => {
    const directory = "/virtual/timeline-extraction-ttl";
    const scanUsage = vi
      .fn()
      .mockResolvedValueOnce({
        totalBytes: 0,
        fileCount: 0,
        fileSizes: new Map<string, number>(),
      })
      .mockResolvedValue({
        totalBytes: 10,
        fileCount: 1,
        fileSizes: new Map([["source-existing.png", 10]]),
      });
    const input = {
      storageKey: "generated/timeline-extractions/source-next.png",
      directory,
      maxBytes: 10,
      scanUsage,
    };

    await expect(
      preflightTimelineFrameExtractionStorage({ ...input, now: 0 })
    ).resolves.toBeUndefined();
    await expect(
      preflightTimelineFrameExtractionStorage({
        ...input,
        now: TIMELINE_EXTRACTION_USAGE_CACHE_TTL_MS - 1,
      })
    ).resolves.toBeUndefined();
    expect(scanUsage).toHaveBeenCalledTimes(1);

    await expect(
      preflightTimelineFrameExtractionStorage({
        ...input,
        now: TIMELINE_EXTRACTION_USAGE_CACHE_TTL_MS,
      })
    ).rejects.toBeInstanceOf(TimelineFrameExtractionStorageQuotaError);
    expect(scanUsage).toHaveBeenCalledTimes(2);

    resetTimelineFrameExtractionLimitsForTesting();
    await expect(
      preflightTimelineFrameExtractionStorage({
        ...input,
        now: TIMELINE_EXTRACTION_USAGE_CACHE_TTL_MS,
      })
    ).rejects.toBeInstanceOf(TimelineFrameExtractionStorageQuotaError);
    expect(scanUsage).toHaveBeenCalledTimes(3);
  });

  it("does not advance cached usage when storage fails", async () => {
    const scanUsage = vi.fn(async () => ({
      totalBytes: 0,
      fileCount: 0,
      fileSizes: new Map<string, number>(),
    }));
    const common = {
      directory: "/virtual/timeline-extraction-failure",
      maxBytes: 5,
      scanUsage,
    };
    await expect(
      storeTimelineFrameExtractionBytes({
        ...common,
        bytes: new Uint8Array(5),
        storageKey: "generated/timeline-extractions/source-failed.png",
        store: async () => {
          throw new Error("disk failed");
        },
      })
    ).rejects.toThrow("disk failed");
    await expect(
      storeTimelineFrameExtractionBytes({
        ...common,
        bytes: new Uint8Array(5),
        storageKey: "generated/timeline-extractions/source-next.png",
        store: async () => "stored",
      })
    ).resolves.toBe("stored");
    expect(scanUsage).toHaveBeenCalledTimes(1);
  });

  it("atomically rechecks concurrent writes after both preflights pass", async () => {
    const directory = "/virtual/timeline-extraction-concurrent";
    const scanUsage = vi.fn(async () => ({
      totalBytes: 0,
      fileCount: 0,
      fileSizes: new Map<string, number>(),
    }));
    const firstKey = "generated/timeline-extractions/source-first.png";
    const secondKey = "generated/timeline-extractions/source-second.png";
    await Promise.all([
      preflightTimelineFrameExtractionStorage({
        storageKey: firstKey,
        directory,
        maxFiles: 1,
        scanUsage,
      }),
      preflightTimelineFrameExtractionStorage({
        storageKey: secondKey,
        directory,
        maxFiles: 1,
        scanUsage,
      }),
    ]);

    const results = await Promise.allSettled([
      storeTimelineFrameExtractionBytes({
        bytes: new Uint8Array(1),
        storageKey: firstKey,
        directory,
        maxFiles: 1,
        scanUsage,
        store: async () => "first",
      }),
      storeTimelineFrameExtractionBytes({
        bytes: new Uint8Array(1),
        storageKey: secondKey,
        directory,
        maxFiles: 1,
        scanUsage,
        store: async () => "second",
      }),
    ]);

    expect(
      results.filter(result => result.status === "fulfilled")
    ).toHaveLength(1);
    const rejection = results.find(result => result.status === "rejected");
    expect(rejection).toMatchObject({
      status: "rejected",
      reason: expect.any(TimelineFrameExtractionStorageQuotaError),
    });
    expect(scanUsage).toHaveBeenCalledTimes(1);
  });
});
