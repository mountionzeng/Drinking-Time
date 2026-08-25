import { beforeEach, describe, expect, it, vi } from "vitest";
import { access } from "node:fs/promises";
import path from "node:path";
import type {
  GeneratedImage,
  TimelineFrameExtractionOperation,
} from "../../drizzle/schema";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  DEFAULT_TIMELINE_VIDEO_EFFECTS,
  type StoryTimelineItem,
} from "../../shared/storyMaterial";
import { TIMELINE_FRAME_EXTRACTION_QUOTA_ERROR } from "../db";
import {
  extractedTimelineFrameClipId,
  extractedTimelineFrameSourceStorageKey,
  extractTimelineFrameForStory,
  resolveTimelineFrameExtraction,
} from "./timelineFrameExtraction";
import {
  consumeTimelineFrameExtractionAllowance,
  resetTimelineFrameExtractionLimitsForTesting,
  TimelineFrameExtractionStorageQuotaError,
} from "./timelineFrameExtractionLimits";

function item(
  stableShotId: string,
  input: Partial<StoryTimelineItem> = {}
): StoryTimelineItem {
  return {
    stableShotId,
    included: true,
    position: 0,
    plannedDurationMs: 2_000,
    timelineStartFrame: 0,
    durationFrames: 60,
    visualLayer: 0,
    transform: { ...DEFAULT_TIMELINE_TRANSFORM },
    ...input,
  };
}

describe("resolveTimelineFrameExtraction", () => {
  it("reuses the exact winning image asset", () => {
    const result = resolveTimelineFrameExtraction({
      timelineFrame: 12,
      document: {
        items: [
          item("shot-a", {
            imageClips: [
              {
                id: "image-clip-a",
                imageId: 77,
                imageUrl: "/images/77.png",
                label: "抽帧",
                offsetFrames: 12,
                timelineStartFrame: 12,
                durationFrames: 1,
                visualLayer: 2,
              },
            ],
          }),
        ],
      },
    });

    expect(result).toEqual({
      status: "ok",
      descriptor: {
        kind: "image",
        timelineFrame: 12,
        visualLayer: 2,
        winnerIdentity: "image-clip:image-clip-a",
        clipId: "image-clip-a",
        ownerStableShotId: "shot-a",
        imageId: 77,
        imageUrl: "/images/77.png",
      },
    });
  });

  it("keeps an anchored shot authoritative over a higher ordinary image", () => {
    const result = resolveTimelineFrameExtraction({
      timelineFrame: 12,
      document: {
        items: [
          item("anchored", {
            anchors: [
              {
                id: "anchor-a",
                timelineFrame: 12,
                sourceType: "primary-video",
                sourceId: "take:11",
                sourceTimeSec: 0.4,
              },
            ],
            primaryVideoEdit: {
              takeId: 11,
              sourceStartSec: 0,
              sourceEndSec: 2,
              effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS },
            },
          }),
          item("image-owner", {
            position: 1,
            visualLayer: 1,
            imageClips: [
              {
                id: "higher-image",
                imageId: 88,
                imageUrl: "/images/88.png",
                label: "高层图",
                offsetFrames: 12,
                timelineStartFrame: 12,
                durationFrames: 1,
                visualLayer: 3,
              },
            ],
          }),
        ],
      },
    });

    expect(result).toMatchObject({
      status: "ok",
      descriptor: {
        kind: "video",
        takeId: 11,
        ownerStableShotId: "anchored",
        winnerIdentity: "story-shot:anchored:primary",
        atSec: 0.4,
      },
    });
  });

  it("maps an owned clip frame into its edited source range", () => {
    const result = resolveTimelineFrameExtraction({
      timelineFrame: 45,
      document: {
        items: [
          item("shot-a", {
            visualClips: [
              {
                id: "owned-a",
                takeId: 22,
                rangeId: 5,
                sourceStableShotId: "source-a",
                videoUrl: "/video.mp4",
                label: "内部片段",
                sourceStartSec: 2,
                sourceEndSec: 4,
                offsetMs: 1_000,
                durationMs: 1_000,
                visualLayer: 0,
                effects: {
                  ...DEFAULT_TIMELINE_VIDEO_EFFECTS,
                  playbackRate: 2,
                },
              },
            ],
          }),
        ],
      },
    });

    expect(result).toMatchObject({
      status: "ok",
      descriptor: {
        kind: "video",
        takeId: 22,
        rangeId: 5,
        sourceStableShotId: "source-a",
        ownerStableShotId: "shot-a",
        sourceClipId: "owned-a",
        winnerIdentity: "owned-video-clip:shot-a:owned-a",
        atSec: 3,
      },
    });
  });

  it("uses the selected current Take when the timeline has no explicit primary edit", () => {
    const result = resolveTimelineFrameExtraction({
      timelineFrame: 30,
      document: { items: [item("shot-a")] },
      currentVideosByShot: new Map([
        [
          "shot-a",
          {
            takeId: 33,
            durationSec: 4,
            rangeId: 9,
            sourceStartSec: 1,
            sourceEndSec: 3,
          },
        ],
      ]),
    });

    expect(result).toMatchObject({
      status: "ok",
      descriptor: {
        kind: "video",
        takeId: 33,
        rangeId: 9,
        atSec: 2,
      },
    });
  });

  it("returns explicit failures for gaps, hidden winners, and undecodable rows", () => {
    expect(
      resolveTimelineFrameExtraction({
        timelineFrame: 90,
        document: { items: [item("shot-a")] },
      })
    ).toEqual({ status: "error", error: "gap" });

    expect(
      resolveTimelineFrameExtraction({
        timelineFrame: 12,
        hiddenVisualLayers: [0],
        document: {
          items: [
            item("shot-a", {
              primaryVideoEdit: {
                takeId: 11,
                sourceStartSec: 0,
                sourceEndSec: 2,
                effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS },
              },
            }),
          ],
        },
      })
    ).toEqual({ status: "error", error: "gap" });

    expect(
      resolveTimelineFrameExtraction({
        timelineFrame: 12,
        document: { items: [item("shot-a")] },
      })
    ).toEqual({ status: "error", error: "media-unavailable" });
  });
});

function receipt(
  status: TimelineFrameExtractionOperation["status"],
  overrides: Partial<TimelineFrameExtractionOperation> = {}
): TimelineFrameExtractionOperation {
  const date = new Date("2026-08-25T00:00:00Z");
  return {
    id: 1,
    storyId: 10,
    userId: 20,
    requestId: "extract-a",
    inputHash: "a".repeat(64),
    timelineFrame: 12,
    operationLayer: 0,
    claimToken: "claim-a",
    leaseUntil: new Date("2099-01-01T00:00:00Z"),
    attempt: 1,
    status,
    winnerIdentity: null,
    descriptor: null,
    imageId: null,
    clipId: null,
    timelineVersion: null,
    errorCode: null,
    createdAt: date,
    updatedAt: date,
    ...overrides,
  };
}

function warehouseImage(
  overrides: Partial<GeneratedImage> = {}
): GeneratedImage {
  return {
    id: 301,
    projectId: null,
    storyId: 10,
    userId: 20,
    shotNo: "SH01",
    shotIdentity: "shot-a",
    imageKey: "generated/timeline-extractions/frame.png",
    imageUrl: "/api/images/frame.png",
    prompt: "时间线抽帧 · 400ms",
    promptCompilationId: null,
    generationType: "initial",
    parentImageId: null,
    isCurrent: false,
    maskKey: null,
    createdAt: new Date("2026-08-25T00:00:00Z"),
    ...overrides,
  };
}

function materialState(
  timelineItem: StoryTimelineItem,
  imageClips: StoryTimelineItem["imageClips"] = timelineItem.imageClips
) {
  const itemWithImages = { ...timelineItem, imageClips };
  return {
    storyId: 10,
    timeline: {
      storyId: 10,
      version: 4,
      items: [itemWithImages],
      overlays: [],
      visualLayerState: { count: 2, hidden: [] },
    },
    shots: [
      {
        stableShotId: "shot-a",
        shotNo: 1,
        cueCode: "0101",
        currentImage: null,
        imageVersions: [],
        relatedImages: [],
        currentVideo: null,
        videoTakes: [],
        timelineItem: itemWithImages,
        visualAssetBinding: null,
      },
    ],
    unassignedImages: [],
    unassignedVideoTakes: [],
    reusableVideoTakes: [],
    visualAssets: { assets: [], proposals: [], bindings: [], images: [] },
  };
}

const workflowInput = {
  storyId: 10,
  userId: 20,
  requestId: "extract-a",
  timelineFrame: 12,
  operationLayer: 0,
};

describe("extractTimelineFrameForStory", () => {
  beforeEach(() => resetTimelineFrameExtractionLimitsForTesting());

  it("captures one authoritative video winner, stores it durably, and places it", async () => {
    vi.useFakeTimers();
    const timelineItem = item("shot-a", {
      primaryVideoEdit: {
        takeId: 44,
        sourceStartSec: 0,
        sourceEndSec: 2,
        effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS },
      },
    });
    const image = warehouseImage();
    const claimed = receipt("claimed");
    const recordDescriptor = vi.fn(async (input: { descriptor: unknown }) => ({
      ...claimed,
      winnerIdentity: (input.descriptor as { winnerIdentity: string })
        .winnerIdentity,
      descriptor: input.descriptor,
    }));
    const settleAsset = vi.fn(async () => ({
      operation: receipt("asset_ready", { imageId: image.id }),
      image,
    }));
    const storeBytes = vi.fn(async () => ({
      status: "ok" as const,
      imageUrl: image.imageUrl,
      imageKey: image.imageKey ?? undefined,
    }));
    const placeFrame = vi.fn(async () => ({
      status: "ok" as const,
      timelineVersion: 5,
      changed: true,
      clipId: extractedTimelineFrameClipId(workflowInput),
      targetLayer: 1,
    }));
    let releaseRender!: () => void;
    let markRenderStarted!: () => void;
    const renderGate = new Promise<void>(resolve => {
      releaseRender = resolve;
    });
    const renderStarted = new Promise<void>(resolve => {
      markRenderStarted = resolve;
    });
    const renderVideoFrame = vi.fn(async (input: { outputPath?: string }) => {
      markRenderStarted();
      await renderGate;
      return { path: input.outputPath!, atSec: 0.4 };
    });
    const renewClaim = vi.fn(async input => ({
      ...claimed,
      claimToken: input.claimToken,
      leaseUntil: new Date(Date.now() + 10 * 60 * 1000),
    }));

    const extraction = extractTimelineFrameForStory(workflowInput, {
      getOperation: vi.fn(async () => null),
      claimOperation: vi.fn(async () => ({
        created: true,
        acquired: true,
        operation: claimed,
      })),
      renewClaim,
      getMaterialState: vi.fn(async () => materialState(timelineItem)),
      recordDescriptor,
      renderVideoFrame,
      readFrameFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
      storeBytes,
      settleAsset,
      placeFrame,
      markSucceeded: vi.fn(async input =>
        receipt("succeeded", {
          imageId: image.id,
          clipId: input.clipId,
          timelineVersion: input.timelineVersion,
        })
      ),
    });
    await renderStarted;
    expect(renderVideoFrame).toHaveBeenCalledTimes(1);
    expect(renewClaim).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(renewClaim).toHaveBeenCalledTimes(2);
    releaseRender();
    const result = await extraction;
    const renewalCountAfterCompletion = renewClaim.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(renewClaim).toHaveBeenCalledTimes(renewalCountAfterCompletion);

    expect(result).toMatchObject({
      status: "ok",
      imageId: image.id,
      timelineVersion: 5,
      targetLayer: 1,
      replayed: false,
    });
    expect(recordDescriptor).toHaveBeenCalledWith(
      expect.objectContaining({
        winnerIdentity: "story-shot:shot-a:primary",
        descriptor: expect.objectContaining({
          kind: "video",
          takeId: 44,
          timelineFrame: 12,
        }),
      })
    );
    expect(storeBytes).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "image/png",
      {
        storageKey: extractedTimelineFrameSourceStorageKey({
          storyId: 10,
          userId: 20,
          takeId: 44,
          rangeId: null,
          atSec: 0.4,
        }),
        requireLocal: true,
      }
    );
    const temporaryOutput = renderVideoFrame.mock.calls[0][0].outputPath!;
    expect(temporaryOutput).toMatch(
      /timeline-frame-extraction-.+\/frame\.png$/
    );
    await expect(access(path.dirname(temporaryOutput))).rejects.toThrow();
    expect(settleAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        claimToken: "claim-a",
        image: expect.objectContaining({
          storyId: 10,
          userId: 20,
          shotIdentity: "shot-a",
        }),
      })
    );
    expect(placeFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        timelineFrame: 12,
        operationLayer: 0,
        imageId: image.id,
      })
    );
  });

  it("terminates a storage quota failure without retrying warehouse storage", async () => {
    const timelineItem = item("shot-a", {
      primaryVideoEdit: {
        takeId: 44,
        sourceStartSec: 0,
        sourceEndSec: 2,
        effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS },
      },
    });
    const claimed = receipt("claimed");
    const failed = receipt("failed", {
      errorCode: "warehouse-quota-exceeded",
    });
    const storeBytes = vi.fn(async () => {
      throw new TimelineFrameExtractionStorageQuotaError();
    });
    const failOperation = vi.fn(async () => failed);
    const getOperation = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(failed);
    const claimOperation = vi
      .fn()
      .mockResolvedValueOnce({
        created: true,
        acquired: true,
        operation: claimed,
      })
      .mockResolvedValueOnce({
        created: false,
        acquired: false,
        operation: failed,
      });

    const result = await extractTimelineFrameForStory(workflowInput, {
      getOperation,
      claimOperation,
      getMaterialState: vi.fn(async () => materialState(timelineItem)),
      recordDescriptor: vi.fn(async input => ({
        ...claimed,
        winnerIdentity: input.winnerIdentity,
        descriptor: input.descriptor,
      })),
      renderVideoFrame: vi.fn(async input => ({
        path: input.outputPath!,
        atSec: 0.4,
      })),
      readFrameFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
      storeBytes,
      failOperation,
    });

    expect(result).toMatchObject({
      status: "error",
      errorCode: "warehouse-quota-exceeded",
      error: "抽帧仓库空间已满，请清理后重试",
      requestDisposition: "replace",
    });
    expect(storeBytes).toHaveBeenCalledTimes(1);
    expect(failOperation).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "warehouse-quota-exceeded" })
    );
    const replay = await extractTimelineFrameForStory(workflowInput, {
      getOperation,
      claimOperation,
      storeBytes,
    });
    expect(replay).toMatchObject({
      status: "error",
      errorCode: "warehouse-quota-exceeded",
      requestDisposition: "replace",
    });
    expect(storeBytes).toHaveBeenCalledTimes(1);
  });

  it("removes the request temporary directory when capture fails", async () => {
    const timelineItem = item("shot-a", {
      primaryVideoEdit: {
        takeId: 44,
        sourceStartSec: 0,
        sourceEndSec: 2,
        effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS },
      },
    });
    const claimed = receipt("claimed");
    let temporaryOutput = "";
    const result = await extractTimelineFrameForStory(workflowInput, {
      claimOperation: vi.fn(async () => ({
        created: true,
        acquired: true,
        operation: claimed,
      })),
      getMaterialState: vi.fn(async () => materialState(timelineItem)),
      recordDescriptor: vi.fn(async input => ({
        ...claimed,
        winnerIdentity: input.winnerIdentity,
        descriptor: input.descriptor,
      })),
      renderVideoFrame: vi.fn(async input => {
        temporaryOutput = input.outputPath!;
        throw new Error("ffmpeg failed");
      }),
      failOperation: vi.fn(async () =>
        receipt("failed", {
          errorCode: "capture-failed",
        })
      ),
    });

    expect(result).toMatchObject({
      status: "error",
      errorCode: "capture-failed",
      requestDisposition: "replace",
    });
    expect(temporaryOutput).toBeTruthy();
    await expect(access(path.dirname(temporaryOutput))).rejects.toThrow();
  });

  it("terminates a full-file-count preflight before rendering or storing", async () => {
    const timelineItem = item("shot-a", {
      primaryVideoEdit: {
        takeId: 44,
        sourceStartSec: 0,
        sourceEndSec: 2,
        effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS },
      },
    });
    const claimed = receipt("claimed");
    const renderVideoFrame = vi.fn();
    const readFrameFile = vi.fn();
    const storeBytes = vi.fn();
    const failOperation = vi.fn(async () =>
      receipt("failed", { errorCode: "warehouse-quota-exceeded" })
    );

    const result = await extractTimelineFrameForStory(workflowInput, {
      claimOperation: vi.fn(async () => ({
        created: true,
        acquired: true,
        operation: claimed,
      })),
      getMaterialState: vi.fn(async () => materialState(timelineItem)),
      recordDescriptor: vi.fn(async input => ({
        ...claimed,
        winnerIdentity: input.winnerIdentity,
        descriptor: input.descriptor,
      })),
      preflightStorage: vi.fn(async () => {
        throw new TimelineFrameExtractionStorageQuotaError();
      }),
      renderVideoFrame,
      readFrameFile,
      storeBytes,
      failOperation,
    });

    expect(result).toMatchObject({
      status: "error",
      errorCode: "warehouse-quota-exceeded",
      error: "抽帧仓库空间已满，请清理后重试",
      requestDisposition: "replace",
    });
    expect(renderVideoFrame).not.toHaveBeenCalled();
    expect(readFrameFile).not.toHaveBeenCalled();
    expect(storeBytes).not.toHaveBeenCalled();
    expect(failOperation).toHaveBeenCalledOnce();
  });

  it("reuses the winning warehouse image without rendering or storing bytes", async () => {
    const image = warehouseImage({ id: 77, imageUrl: "/images/77.png" });
    const timelineItem = item("shot-a", {
      imageClips: [
        {
          id: "image-clip-a",
          imageId: image.id,
          imageUrl: image.imageUrl,
          label: "图片",
          offsetFrames: 12,
          timelineStartFrame: 12,
          durationFrames: 1,
          visualLayer: 1,
        },
      ],
    });
    const claimed = receipt("claimed");
    const renderVideoFrame = vi.fn();
    const storeBytes = vi.fn();
    const settleAsset = vi.fn(async input => ({
      operation: receipt("asset_ready", { imageId: input.existingImageId }),
      image,
    }));

    const result = await extractTimelineFrameForStory(workflowInput, {
      claimOperation: vi.fn(async () => ({
        created: true,
        acquired: true,
        operation: claimed,
      })),
      getMaterialState: vi.fn(async () => materialState(timelineItem)),
      recordDescriptor: vi.fn(async input => ({
        ...claimed,
        winnerIdentity: input.winnerIdentity,
        descriptor: input.descriptor,
      })),
      renderVideoFrame,
      storeBytes,
      settleAsset,
      placeFrame: vi.fn(async () => ({
        status: "ok" as const,
        timelineVersion: 5,
        changed: true,
        targetLayer: 1,
      })),
      markSucceeded: vi.fn(async () =>
        receipt("succeeded", {
          imageId: image.id,
          clipId: extractedTimelineFrameClipId(workflowInput),
          timelineVersion: 5,
        })
      ),
    });

    expect(result).toMatchObject({ status: "ok", imageId: 77 });
    expect(settleAsset).toHaveBeenCalledWith(
      expect.objectContaining({ existingImageId: 77 })
    );
    expect(renderVideoFrame).not.toHaveBeenCalled();
    expect(storeBytes).not.toHaveBeenCalled();
  });

  it("reuses one warehouse still for the same video source across request ids", async () => {
    const timelineItem = item("shot-a", {
      primaryVideoEdit: {
        takeId: 44,
        sourceStartSec: 0,
        sourceEndSec: 2,
        effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS },
      },
    });
    const sourceKey = extractedTimelineFrameSourceStorageKey({
      storyId: 10,
      userId: 20,
      takeId: 44,
      rangeId: null,
      atSec: 0.4,
    });
    const image = warehouseImage({ imageKey: sourceKey });
    const storyImages: GeneratedImage[] = [];
    const storeBytes = vi.fn(async () => ({
      status: "ok" as const,
      imageUrl: image.imageUrl,
      imageKey: sourceKey,
    }));
    const renderVideoFrame = vi.fn(async () => ({
      path: "/tmp/frame.png",
      atSec: 0.4,
    }));
    const settleAsset = vi.fn(
      async (input: { image?: unknown; existingImageId?: number }) => {
        if (input.image && storyImages.length === 0) storyImages.push(image);
        return {
          operation: receipt("asset_ready", { imageId: image.id }),
          image,
        };
      }
    );
    const dependencies = {
      getOperation: vi.fn(async () => null),
      claimOperation: vi.fn(async () => ({
        created: true,
        acquired: true,
        operation: receipt("claimed"),
      })),
      getMaterialState: vi.fn(async () => materialState(timelineItem)),
      findImageByKey: vi.fn(
        async (_storyId, _userId, imageKey) =>
          storyImages.find(candidate => candidate.imageKey === imageKey) ?? null
      ),
      recordDescriptor: vi.fn(async input => ({
        ...receipt("claimed"),
        winnerIdentity: input.winnerIdentity,
        descriptor: input.descriptor,
      })),
      renderVideoFrame,
      readFrameFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
      storeBytes,
      settleAsset,
      placeFrame: vi.fn(async () => ({
        status: "ok" as const,
        timelineVersion: 5,
        changed: true,
        targetLayer: 1,
      })),
      markSucceeded: vi.fn(async input =>
        receipt("succeeded", {
          imageId: image.id,
          clipId: input.clipId,
          timelineVersion: input.timelineVersion,
        })
      ),
    };

    await extractTimelineFrameForStory(workflowInput, dependencies);
    await extractTimelineFrameForStory(
      { ...workflowInput, requestId: "extract-b" },
      dependencies
    );

    expect(renderVideoFrame).toHaveBeenCalledTimes(1);
    expect(storeBytes).toHaveBeenCalledTimes(1);
    expect(settleAsset).toHaveBeenLastCalledWith(
      expect.objectContaining({ existingImageId: image.id })
    );
  });

  it("does not expose placement service errors", async () => {
    const image = warehouseImage();
    const operation = receipt("asset_ready", { imageId: image.id });
    const result = await extractTimelineFrameForStory(workflowInput, {
      getOperation: vi.fn(async () => operation),
      claimOperation: vi.fn(async () => ({
        created: false,
        acquired: true,
        operation,
      })),
      getImageById: vi.fn(async () => image),
      placeFrame: vi.fn(async () => ({
        status: "error" as const,
        errorKind: "invalid" as const,
        error: "SQL duplicate key: private_table.secret_column",
      })),
    });

    expect(result).toMatchObject({
      status: "error",
      errorCode: "placement-failed",
      error: "抽帧图片放置失败，请重试",
    });
    expect(JSON.stringify(result)).not.toContain("private_table");
  });

  it("maps durable receipt quota failures to a stable safe error", async () => {
    const result = await extractTimelineFrameForStory(workflowInput, {
      getOperation: vi.fn(async () => null),
      claimOperation: vi.fn(async () => {
        throw new Error(
          `${TIMELINE_FRAME_EXTRACTION_QUOTA_ERROR}: private receipt count 5001`
        );
      }),
    });

    expect(result).toEqual({
      status: "error",
      requestId: workflowInput.requestId,
      errorCode: "extraction-quota-exceeded",
      errorKind: "invalid",
      requestDisposition: "continue",
      error: "抽帧记录已达到保存上限，请整理项目后再试",
    });
    expect(JSON.stringify(result)).not.toContain("5001");
  });

  it.each(["claimed", "asset_ready", "succeeded"] as const)(
    "does not charge a durable %s receipt as a new intent after the rate window",
    async status => {
      const now = Date.now();
      for (let index = 0; index < 60; index += 1) {
        consumeTimelineFrameExtractionAllowance({
          userId: workflowInput.userId,
          storyId: workflowInput.storyId,
          requestId: `new-${index}`,
          now,
        });
      }
      const image = warehouseImage();
      const operation = receipt(status, {
        imageId: status === "claimed" ? null : image.id,
        clipId: status === "succeeded" ? "persisted-clip" : null,
        timelineVersion: status === "succeeded" ? 8 : null,
      });
      const result = await extractTimelineFrameForStory(workflowInput, {
        getOperation: vi.fn(async () => operation),
        claimOperation: vi.fn(async () => ({
          created: false,
          acquired: status !== "claimed",
          operation,
        })),
        getImageById: vi.fn(async () => image),
        placeFrame: vi.fn(async () => ({
          status: "ok" as const,
          timelineVersion: 8,
          changed: false,
          targetLayer: 1,
        })),
        markSucceeded: vi.fn(async input =>
          receipt("succeeded", {
            imageId: image.id,
            clipId: input.clipId,
            timelineVersion: input.timelineVersion,
          })
        ),
      });

      expect(result.status).not.toBe("error");
    }
  );

  it("replays a succeeded receipt without resolving or placing again", async () => {
    const image = warehouseImage();
    const getMaterialState = vi.fn();
    const placeFrame = vi.fn();
    const operation = receipt("succeeded", {
      imageId: image.id,
      clipId: "persisted-clip",
      timelineVersion: 8,
    });

    const result = await extractTimelineFrameForStory(workflowInput, {
      claimOperation: vi.fn(async () => ({
        created: false,
        acquired: false,
        operation,
      })),
      getImageById: vi.fn(async () => image),
      getMaterialState,
      placeFrame,
    });

    expect(result).toEqual({
      status: "ok",
      requestId: "extract-a",
      imageId: image.id,
      imageUrl: image.imageUrl,
      clipId: "persisted-clip",
      timelineVersion: 8,
      replayed: true,
    });
    expect(getMaterialState).not.toHaveBeenCalled();
    expect(placeFrame).not.toHaveBeenCalled();
  });

  it("continues asset-ready placement after a lost response", async () => {
    const image = warehouseImage();
    const placeFrame = vi.fn(async () => ({
      status: "ok" as const,
      timelineVersion: 9,
      changed: false,
      targetLayer: 3,
    }));
    const markSucceeded = vi.fn(async input =>
      receipt("succeeded", {
        imageId: image.id,
        clipId: input.clipId,
        timelineVersion: input.timelineVersion,
      })
    );

    const result = await extractTimelineFrameForStory(workflowInput, {
      claimOperation: vi.fn(async () => ({
        created: false,
        acquired: false,
        operation: receipt("asset_ready", { imageId: image.id }),
      })),
      getImageById: vi.fn(async () => image),
      placeFrame,
      markSucceeded,
    });

    expect(result).toMatchObject({
      status: "ok",
      timelineVersion: 9,
      targetLayer: 3,
      replayed: true,
    });
    expect(placeFrame).toHaveBeenCalledTimes(1);
    expect(markSucceeded).toHaveBeenCalledTimes(1);
  });

  it.each(["succeeded", "asset_ready"] as const)(
    "returns a structured retryable error when a %s receipt image cannot be loaded",
    async status => {
      const image = warehouseImage();
      const operation = receipt(status, {
        imageId: image.id,
        clipId: status === "succeeded" ? "persisted-clip" : null,
        timelineVersion: status === "succeeded" ? 8 : null,
      });
      const placeFrame = vi.fn();

      const result = await extractTimelineFrameForStory(workflowInput, {
        claimOperation: vi.fn(async () => ({
          created: false,
          acquired: false,
          operation,
        })),
        getImageById: vi.fn(async () => {
          throw new Error("database temporarily unavailable");
        }),
        placeFrame,
      });

      expect(result).toMatchObject({
        status: "error",
        errorCode: "receipt-asset-load-failed",
        errorKind: "retryable",
        error: "抽帧图片读取失败，请重试",
      });
      expect(placeFrame).not.toHaveBeenCalled();
    }
  );

  it("releases a temporary material read failure so the same request can continue immediately", async () => {
    const timelineItem = item("shot-a", {
      primaryVideoEdit: {
        takeId: 44,
        sourceStartSec: 0,
        sourceEndSec: 2,
        effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS },
      },
    });
    const image = warehouseImage();
    const firstClaim = receipt("claimed", { claimToken: "claim-first" });
    const retryClaim = receipt("claimed", { claimToken: "claim-retry" });
    let released = false;
    let claimCount = 0;
    const claimOperation = vi.fn(async () => {
      claimCount += 1;
      return claimCount === 1
        ? { created: true, acquired: true, operation: firstClaim }
        : { created: false, acquired: released, operation: retryClaim };
    });
    const releaseClaim = vi.fn(async () => {
      released = true;
      return firstClaim;
    });
    const getMaterialState = vi
      .fn()
      .mockRejectedValueOnce(new Error("material store busy"))
      .mockResolvedValue(materialState(timelineItem));
    const recordDescriptor = vi.fn(async input => ({
      ...retryClaim,
      winnerIdentity: input.winnerIdentity,
      descriptor: input.descriptor,
    }));

    const first = await extractTimelineFrameForStory(workflowInput, {
      claimOperation,
      releaseClaim,
      getMaterialState,
    });
    const retry = await extractTimelineFrameForStory(workflowInput, {
      claimOperation,
      releaseClaim,
      getMaterialState,
      recordDescriptor,
      renderVideoFrame: vi.fn(async () => ({
        path: "/tmp/frame.png",
        atSec: 0.4,
      })),
      readFrameFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
      storeBytes: vi.fn(async () => ({
        status: "ok" as const,
        imageUrl: image.imageUrl,
        imageKey: image.imageKey ?? undefined,
      })),
      settleAsset: vi.fn(async () => ({
        operation: receipt("asset_ready", { imageId: image.id }),
        image,
      })),
      placeFrame: vi.fn(async () => ({
        status: "ok" as const,
        timelineVersion: 5,
        changed: true,
        targetLayer: 1,
      })),
      markSucceeded: vi.fn(async input =>
        receipt("succeeded", {
          imageId: image.id,
          clipId: input.clipId,
          timelineVersion: input.timelineVersion,
        })
      ),
    });

    expect(first).toMatchObject({
      status: "error",
      errorCode: "material-load-failed",
      errorKind: "retryable",
    });
    expect(retry).toMatchObject({ status: "ok", imageId: image.id });
    expect(releaseClaim).toHaveBeenCalledWith(
      expect.objectContaining({ claimToken: "claim-first" })
    );
    expect(recordDescriptor).toHaveBeenCalledWith(
      expect.objectContaining({ claimToken: "claim-retry" })
    );
  });

  it("releases a temporary descriptor write failure so the same request can continue immediately", async () => {
    const timelineItem = item("shot-a", {
      primaryVideoEdit: {
        takeId: 44,
        sourceStartSec: 0,
        sourceEndSec: 2,
        effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS },
      },
    });
    const image = warehouseImage();
    const firstClaim = receipt("claimed", { claimToken: "claim-first" });
    const retryClaim = receipt("claimed", { claimToken: "claim-retry" });
    let released = false;
    let claimCount = 0;
    const claimOperation = vi.fn(async () => {
      claimCount += 1;
      return claimCount === 1
        ? { created: true, acquired: true, operation: firstClaim }
        : { created: false, acquired: released, operation: retryClaim };
    });
    const releaseClaim = vi.fn(async () => {
      released = true;
      return firstClaim;
    });
    const recordDescriptor = vi
      .fn()
      .mockRejectedValueOnce(new Error("receipt store busy"))
      .mockImplementation(async input => ({
        ...retryClaim,
        winnerIdentity: input.winnerIdentity,
        descriptor: input.descriptor,
      }));
    const dependencies = {
      claimOperation,
      releaseClaim,
      getMaterialState: vi.fn(async () => materialState(timelineItem)),
      recordDescriptor,
      renderVideoFrame: vi.fn(async () => ({
        path: "/tmp/frame.png",
        atSec: 0.4,
      })),
      readFrameFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
      storeBytes: vi.fn(async () => ({
        status: "ok" as const,
        imageUrl: image.imageUrl,
        imageKey: image.imageKey ?? undefined,
      })),
      settleAsset: vi.fn(async () => ({
        operation: receipt("asset_ready", { imageId: image.id }),
        image,
      })),
      placeFrame: vi.fn(async () => ({
        status: "ok" as const,
        timelineVersion: 5,
        changed: true,
        targetLayer: 1,
      })),
      markSucceeded: vi.fn(async input =>
        receipt("succeeded", {
          imageId: image.id,
          clipId: input.clipId,
          timelineVersion: input.timelineVersion,
        })
      ),
    };

    const first = await extractTimelineFrameForStory(
      workflowInput,
      dependencies
    );
    const retry = await extractTimelineFrameForStory(
      workflowInput,
      dependencies
    );

    expect(first).toMatchObject({
      status: "error",
      errorCode: "descriptor-save-failed",
      errorKind: "retryable",
    });
    expect(retry).toMatchObject({ status: "ok", imageId: image.id });
    expect(releaseClaim).toHaveBeenCalledWith(
      expect.objectContaining({ claimToken: "claim-first" })
    );
    expect(recordDescriptor).toHaveBeenLastCalledWith(
      expect.objectContaining({ claimToken: "claim-retry" })
    );
  });

  it("releases a temporary asset settlement failure and resumes from the saved descriptor", async () => {
    const image = warehouseImage({ id: 77, imageUrl: "/images/77.png" });
    const timelineItem = item("shot-a", {
      imageClips: [
        {
          id: "image-clip-a",
          imageId: image.id,
          imageUrl: image.imageUrl,
          label: "图片",
          offsetFrames: 12,
          timelineStartFrame: 12,
          durationFrames: 1,
          visualLayer: 1,
        },
      ],
    });
    const firstClaim = receipt("claimed", { claimToken: "claim-first" });
    let persistedDescriptor: unknown = null;
    let released = false;
    let claimCount = 0;
    const claimOperation = vi.fn(async () => {
      claimCount += 1;
      return claimCount === 1
        ? { created: true, acquired: true, operation: firstClaim }
        : {
            created: false,
            acquired: released,
            operation: receipt("claimed", {
              claimToken: "claim-retry",
              winnerIdentity: "image-clip:image-clip-a",
              descriptor: persistedDescriptor,
            }),
          };
    });
    const releaseClaim = vi.fn(async () => {
      released = true;
      return firstClaim;
    });
    const recordDescriptor = vi.fn(async input => {
      persistedDescriptor = input.descriptor;
      return {
        ...firstClaim,
        winnerIdentity: input.winnerIdentity,
        descriptor: input.descriptor,
      };
    });
    const settleAsset = vi
      .fn()
      .mockRejectedValueOnce(new Error("image row lock timeout"))
      .mockResolvedValue({
        operation: receipt("asset_ready", { imageId: image.id }),
        image,
      });
    const dependencies = {
      claimOperation,
      releaseClaim,
      getMaterialState: vi.fn(async () => materialState(timelineItem)),
      recordDescriptor,
      settleAsset,
      placeFrame: vi.fn(async () => ({
        status: "ok" as const,
        timelineVersion: 5,
        changed: true,
        targetLayer: 1,
      })),
      markSucceeded: vi.fn(async input =>
        receipt("succeeded", {
          imageId: image.id,
          clipId: input.clipId,
          timelineVersion: input.timelineVersion,
        })
      ),
    };

    const first = await extractTimelineFrameForStory(
      workflowInput,
      dependencies
    );
    const retry = await extractTimelineFrameForStory(
      workflowInput,
      dependencies
    );

    expect(first).toMatchObject({
      status: "error",
      errorCode: "asset-settle-failed",
      errorKind: "retryable",
    });
    expect(retry).toMatchObject({ status: "ok", imageId: image.id });
    expect(recordDescriptor).toHaveBeenCalledTimes(1);
    expect(settleAsset).toHaveBeenLastCalledWith(
      expect.objectContaining({
        claimToken: "claim-retry",
        existingImageId: 77,
      })
    );
  });

  it.each([
    ["media-unavailable", "invalid"],
    ["descriptor-invalid", "invalid"],
    ["capture-failed", "retryable"],
    ["warehouse-failed", "retryable"],
  ] as const)(
    "requires a new request when replaying terminal %s",
    async (errorCode, errorKind) => {
      const result = await extractTimelineFrameForStory(workflowInput, {
        claimOperation: vi.fn(async () => ({
          created: false,
          acquired: false,
          operation: receipt("failed", { errorCode }),
        })),
      });

      expect(result).toMatchObject({
        status: "error",
        errorCode,
        errorKind,
        requestDisposition: "replace",
      });
    }
  );

  it("keeps the request reusable when a terminal receipt write itself fails", async () => {
    const releaseClaim = vi.fn(async () => receipt("claimed"));
    const result = await extractTimelineFrameForStory(workflowInput, {
      claimOperation: vi.fn(async () => ({
        created: true,
        acquired: true,
        operation: receipt("claimed"),
      })),
      getMaterialState: vi.fn(async () => materialState(item("shot-a"))),
      failOperation: vi.fn(async () => {
        throw new Error("receipt store unavailable");
      }),
      releaseClaim,
    });

    expect(result).toMatchObject({
      status: "error",
      errorCode: "media-unavailable",
      requestDisposition: "continue",
    });
    expect(releaseClaim).toHaveBeenCalledWith(
      expect.objectContaining({ claimToken: "claim-a" })
    );
  });

  it("returns pending for a live competing claim and records a gap as terminal", async () => {
    const busy = await extractTimelineFrameForStory(workflowInput, {
      claimOperation: vi.fn(async () => ({
        created: false,
        acquired: false,
        operation: receipt("claimed"),
      })),
    });
    expect(busy).toMatchObject({ status: "pending" });

    const failOperation = vi.fn(async input =>
      receipt("failed", { errorCode: input.errorCode })
    );
    const gap = await extractTimelineFrameForStory(workflowInput, {
      claimOperation: vi.fn(async () => ({
        created: true,
        acquired: true,
        operation: receipt("claimed"),
      })),
      getMaterialState: vi.fn(async () =>
        materialState(item("shot-a", { timelineStartFrame: 0 }))
      ),
      failOperation,
    });
    expect(gap).toMatchObject({
      status: "error",
      errorCode: "media-unavailable",
      errorKind: "invalid",
    });
    expect(failOperation).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "media-unavailable" })
    );
  });
});
