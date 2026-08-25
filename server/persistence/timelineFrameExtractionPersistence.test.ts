import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  fail: vi.fn(),
  getImage: vi.fn(),
  getImageByKey: vi.fn(),
  getReceipt: vi.fn(),
  complete: vi.fn(),
  record: vi.fn(),
  release: vi.fn(),
  renew: vi.fn(),
  settle: vi.fn(),
}));

vi.mock("../db", () => ({
  claimTimelineFrameExtractionOperation: mocks.claim,
  failTimelineFrameExtractionOperation: mocks.fail,
  getGeneratedImageById: mocks.getImage,
  getGeneratedImageByStoryAndImageKey: mocks.getImageByKey,
  getTimelineFrameExtractionOperation: mocks.getReceipt,
  markTimelineFrameExtractionSucceeded: mocks.complete,
  recordTimelineFrameExtractionDescriptor: mocks.record,
  releaseTimelineFrameExtractionClaim: mocks.release,
  renewTimelineFrameExtractionClaim: mocks.renew,
  settleTimelineFrameExtractionAsset: mocks.settle,
}));

import { timelineFrameExtractionReceiptStore } from "./timelineFrameExtractionPersistence";

const receiptRow = {
  id: 901,
  storyId: 4,
  userId: 7,
  requestId: "request-a",
  inputHash: "hash-a",
  timelineFrame: 12,
  operationLayer: 3,
  claimToken: "claim-a",
  leaseUntil: new Date("2026-08-25T00:00:00.000Z"),
  attempt: 2,
  status: "claimed" as const,
  winnerIdentity: null,
  descriptor: null,
  imageId: null,
  clipId: null,
  timelineVersion: null,
  errorCode: null,
  createdAt: new Date("2026-08-24T00:00:00.000Z"),
  updatedAt: new Date("2026-08-24T00:00:00.000Z"),
};

describe("timeline frame extraction persistence contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps a DB claim row into the durable receipt contract", async () => {
    mocks.claim.mockResolvedValue({
      created: true,
      acquired: true,
      operation: receiptRow,
    });
    const input = {
      storyId: 4,
      userId: 7,
      requestId: "request-a",
      inputHash: "hash-a",
      timelineFrame: 12,
      operationLayer: 3,
    };

    const claimed =
      await timelineFrameExtractionReceiptStore.claimIntent(input);

    expect(mocks.claim).toHaveBeenCalledWith(input);
    expect(claimed).toMatchObject({
      created: true,
      acquired: true,
      operation: {
        storyId: 4,
        userId: 7,
        requestId: "request-a",
        status: "claimed",
        claimToken: "claim-a",
      },
    });
    expect(claimed.operation).not.toHaveProperty("id");
    expect(claimed.operation).not.toHaveProperty("createdAt");
    expect(claimed.operation).not.toHaveProperty("updatedAt");
  });

  it("maps warehouse rows without exposing unrelated generated-image fields", async () => {
    mocks.getImage.mockResolvedValue({
      id: 33,
      storyId: 4,
      userId: 7,
      imageKey: "generated/frame.png",
      imageUrl: "/frame.png",
      prompt: "private persistence detail",
      createdAt: new Date(),
    });

    const image =
      await timelineFrameExtractionReceiptStore.loadWarehouseImage(33);

    expect(image).toEqual({
      id: 33,
      storyId: 4,
      userId: 7,
      imageKey: "generated/frame.png",
      imageUrl: "/frame.png",
    });
  });

  it("looks up a reusable warehouse image by its scoped storage key", async () => {
    mocks.getImageByKey.mockResolvedValue({
      id: 34,
      storyId: 4,
      userId: 7,
      imageKey: "generated/reusable.png",
      imageUrl: "/reusable.png",
    });

    const image =
      await timelineFrameExtractionReceiptStore.findWarehouseImageByKey(
        4,
        7,
        "generated/reusable.png"
      );

    expect(mocks.getImageByKey).toHaveBeenCalledWith(
      4,
      7,
      "generated/reusable.png"
    );
    expect(image?.id).toBe(34);
  });
});
