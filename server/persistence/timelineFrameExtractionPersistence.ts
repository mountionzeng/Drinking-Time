import type {
  GeneratedImage,
  InsertGeneratedImage,
  TimelineFrameExtractionOperation,
} from "../../drizzle/schema";
import {
  claimTimelineFrameExtractionOperation,
  failTimelineFrameExtractionOperation,
  getGeneratedImageById,
  getGeneratedImageByStoryAndImageKey,
  getTimelineFrameExtractionOperation,
  markTimelineFrameExtractionSucceeded,
  recordTimelineFrameExtractionDescriptor,
  releaseTimelineFrameExtractionClaim,
  renewTimelineFrameExtractionClaim,
  settleTimelineFrameExtractionAsset,
} from "../db";
export { TIMELINE_FRAME_EXTRACTION_QUOTA_ERROR } from "./timelineFrameExtractionErrors";

export type TimelineFrameExtractionOwner = {
  storyId: number;
  userId: number;
  requestId: string;
};

export type TimelineFrameExtractionReceipt = TimelineFrameExtractionOwner & {
  inputHash: string;
  timelineFrame: number;
  operationLayer: number;
  claimToken: string;
  leaseUntil: Date;
  attempt: number;
  status: "claimed" | "asset_ready" | "succeeded" | "failed";
  winnerIdentity: string | null;
  descriptor: unknown;
  imageId: number | null;
  clipId: string | null;
  timelineVersion: number | null;
  errorCode: string | null;
};

export type TimelineFrameExtractionWarehouseImage = {
  id: number;
  storyId: number | null;
  userId: number | null;
  imageKey: string | null;
  imageUrl: string;
};

export type TimelineFrameExtractionNewWarehouseImage = {
  projectId: number | null;
  storyId: number;
  userId: number;
  shotNo: string | null;
  shotIdentity: string;
  imageKey: string | null;
  imageUrl: string;
  prompt: string;
  promptCompilationId: number | null;
  parentImageId: number | null;
  generationType: "initial";
  maskKey: string | null;
};

export type ClaimTimelineFrameExtractionInput = TimelineFrameExtractionOwner & {
  inputHash: string;
  timelineFrame: number;
  operationLayer: number;
};

export type ClaimTimelineFrameExtractionResult = {
  created: boolean;
  acquired: boolean;
  operation: TimelineFrameExtractionReceipt;
};

export type TimelineFrameExtractionReceiptStore = {
  loadReceipt(
    input: TimelineFrameExtractionOwner
  ): Promise<TimelineFrameExtractionReceipt | null>;
  claimIntent(
    input: ClaimTimelineFrameExtractionInput
  ): Promise<ClaimTimelineFrameExtractionResult>;
  recordWinner(
    input: TimelineFrameExtractionOwner & {
      claimToken: string;
      winnerIdentity: string;
      descriptor: unknown;
    }
  ): Promise<TimelineFrameExtractionReceipt | null>;
  releaseIntent(
    input: TimelineFrameExtractionOwner & { claimToken: string }
  ): Promise<TimelineFrameExtractionReceipt | null>;
  renewIntent(
    input: TimelineFrameExtractionOwner & { claimToken: string }
  ): Promise<TimelineFrameExtractionReceipt | null>;
  failIntent(
    input: TimelineFrameExtractionOwner & {
      claimToken: string;
      errorCode: string;
    }
  ): Promise<TimelineFrameExtractionReceipt | null>;
  settleWarehouseAsset(
    input: TimelineFrameExtractionOwner & { claimToken: string } & (
        | { existingImageId: number; image?: never }
        | {
            existingImageId?: never;
            image: TimelineFrameExtractionNewWarehouseImage;
          }
      )
  ): Promise<{
    operation: TimelineFrameExtractionReceipt;
    image: TimelineFrameExtractionWarehouseImage;
  }>;
  completePlacement(
    input: TimelineFrameExtractionOwner & {
      clipId: string;
      timelineVersion: number;
    }
  ): Promise<TimelineFrameExtractionReceipt | null>;
  loadWarehouseImage(
    imageId: number
  ): Promise<TimelineFrameExtractionWarehouseImage | null>;
  findWarehouseImageByKey(
    storyId: number,
    userId: number,
    imageKey: string
  ): Promise<TimelineFrameExtractionWarehouseImage | null>;
};

function receiptFromRow(
  row: TimelineFrameExtractionOperation | null
): TimelineFrameExtractionReceipt | null {
  if (!row) return null;
  return {
    storyId: row.storyId,
    userId: row.userId,
    requestId: row.requestId,
    inputHash: row.inputHash,
    timelineFrame: row.timelineFrame,
    operationLayer: row.operationLayer,
    claimToken: row.claimToken,
    leaseUntil: row.leaseUntil,
    attempt: row.attempt,
    status: row.status,
    winnerIdentity: row.winnerIdentity,
    descriptor: row.descriptor,
    imageId: row.imageId,
    clipId: row.clipId,
    timelineVersion: row.timelineVersion,
    errorCode: row.errorCode,
  };
}

function warehouseImageFromRow(
  row: GeneratedImage | null
): TimelineFrameExtractionWarehouseImage | null {
  if (!row) return null;
  return {
    id: row.id,
    storyId: row.storyId,
    userId: row.userId,
    imageKey: row.imageKey,
    imageUrl: row.imageUrl,
  };
}

/**
 * DB adapter for the durable extraction receipt state machine. Every method
 * maps rows into the domain contract so workflow code cannot grow coupled to
 * table ids, timestamps, or insert-row signatures.
 */
export const timelineFrameExtractionReceiptStore: TimelineFrameExtractionReceiptStore =
  {
    async loadReceipt(input) {
      return receiptFromRow(await getTimelineFrameExtractionOperation(input));
    },
    async claimIntent(input) {
      const claimed = await claimTimelineFrameExtractionOperation(input);
      return {
        created: claimed.created,
        acquired: claimed.acquired,
        operation: receiptFromRow(claimed.operation)!,
      };
    },
    async recordWinner(input) {
      return receiptFromRow(
        await recordTimelineFrameExtractionDescriptor(input)
      );
    },
    async releaseIntent(input) {
      return receiptFromRow(await releaseTimelineFrameExtractionClaim(input));
    },
    async renewIntent(input) {
      return receiptFromRow(await renewTimelineFrameExtractionClaim(input));
    },
    async failIntent(input) {
      return receiptFromRow(await failTimelineFrameExtractionOperation(input));
    },
    async settleWarehouseAsset(input) {
      const settled = await settleTimelineFrameExtractionAsset({
        ...input,
        ...(input.image
          ? { image: input.image satisfies InsertGeneratedImage }
          : { existingImageId: input.existingImageId }),
      });
      return {
        operation: receiptFromRow(settled.operation)!,
        image: warehouseImageFromRow(settled.image)!,
      };
    },
    async completePlacement(input) {
      return receiptFromRow(await markTimelineFrameExtractionSucceeded(input));
    },
    async loadWarehouseImage(imageId) {
      return warehouseImageFromRow(await getGeneratedImageById(imageId));
    },
    async findWarehouseImageByKey(storyId, userId, imageKey) {
      return warehouseImageFromRow(
        await getGeneratedImageByStoryAndImageKey(storyId, userId, imageKey)
      );
    },
  };
