/** Persistence operations for frameExtractions. Local and MySQL behavior share this boundary. */
import { eq, and, gte, isNull, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { TIMELINE_FRAME_EXTRACTION_QUOTA_ERROR } from "../persistence/timelineFrameExtractionErrors";
import { canonicalJsonStringify } from "../../shared/canonicalJson";
import {
  users,
  stories,
  InsertGeneratedImage,
  generatedImages,
  GeneratedImage,
  timelineFrameExtractionOperations,
  TimelineFrameExtractionOperation,
} from "../../drizzle/schema";
import {
  ensureMemoryLoaded,
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
  timelineFrameExtractionMemoryLock,
} from "./runtime";

type TimelineFrameExtractionOwner = {
  storyId: number;
  userId: number;
  requestId: string;
};

const TIMELINE_FRAME_EXTRACTION_LEASE_MS = 10 * 60 * 1000;

function normalizedExtractionCoordinates(input: {
  timelineFrame: number;
  operationLayer: number;
}) {
  return {
    timelineFrame: Math.max(0, Math.round(input.timelineFrame)),
    operationLayer: Math.max(0, Math.round(input.operationLayer)),
  };
}

function assertMatchingExtractionClaim(
  existing: TimelineFrameExtractionOperation,
  input: { inputHash: string; timelineFrame: number; operationLayer: number }
) {
  const normalized = normalizedExtractionCoordinates(input);
  if (
    existing.inputHash !== input.inputHash ||
    existing.timelineFrame !== normalized.timelineFrame ||
    existing.operationLayer !== normalized.operationLayer
  ) {
    throw new Error("抽帧 requestId 已用于不同输入（claim conflict）");
  }
}

function assertActiveExtractionClaim(
  current: TimelineFrameExtractionOperation,
  claimToken: string
) {
  if (
    current.claimToken !== claimToken ||
    current.leaseUntil.getTime() <= Date.now()
  ) {
    throw new Error("抽帧 claim 已失效");
  }
}

function extractionResultMatches(
  current: TimelineFrameExtractionOperation,
  result: { clipId: string; timelineVersion: number }
) {
  return (
    current.clipId === result.clipId &&
    current.timelineVersion === result.timelineVersion
  );
}

function extractionDescriptorMatches(
  current: TimelineFrameExtractionOperation,
  value: { winnerIdentity: string; descriptor: unknown }
) {
  return (
    current.winnerIdentity === value.winnerIdentity &&
    canonicalJsonStringify(current.descriptor) ===
      canonicalJsonStringify(value.descriptor)
  );
}

export const TIMELINE_FRAME_EXTRACTION_DAILY_RECEIPT_LIMIT = 240;

export const TIMELINE_FRAME_EXTRACTION_USER_RECEIPT_LIMIT = 5_000;

export const TIMELINE_FRAME_EXTRACTION_STORY_RECEIPT_LIMIT = 2_000;

export function assertTimelineFrameExtractionReceiptQuota(input: {
  last24Hours: number;
  userTotal: number;
  storyTotal: number;
}): void {
  if (
    input.last24Hours >= TIMELINE_FRAME_EXTRACTION_DAILY_RECEIPT_LIMIT ||
    input.userTotal >= TIMELINE_FRAME_EXTRACTION_USER_RECEIPT_LIMIT ||
    input.storyTotal >= TIMELINE_FRAME_EXTRACTION_STORY_RECEIPT_LIMIT
  ) {
    throw new Error(TIMELINE_FRAME_EXTRACTION_QUOTA_ERROR);
  }
}

async function withTimelineFrameExtractionMemoryLock<T>(
  owner: TimelineFrameExtractionOwner,
  run: () => Promise<T>
): Promise<T> {
  // All extraction writes for one user share a lock. Besides making receipt
  // quota checks atomic, this makes imageKey lookup+insert mutually exclusive
  // across different request ids and Stories in local-persist mode.
  const key = String(owner.userId);
  return timelineFrameExtractionMemoryLock.run(key, run);
}

function memoryTimelineFrameExtractionOperation(
  owner: TimelineFrameExtractionOwner
): TimelineFrameExtractionOperation | null {
  return (
    memoryState.timelineFrameExtractionOperations.find(
      row =>
        row.storyId === owner.storyId &&
        row.userId === owner.userId &&
        row.requestId === owner.requestId
    ) ?? null
  );
}

export async function getTimelineFrameExtractionOperation(
  owner: TimelineFrameExtractionOwner
): Promise<TimelineFrameExtractionOperation | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryTimelineFrameExtractionOperation(owner);
  }
  const [row] = await db
    .select()
    .from(timelineFrameExtractionOperations)
    .where(
      and(
        eq(timelineFrameExtractionOperations.storyId, owner.storyId),
        eq(timelineFrameExtractionOperations.userId, owner.userId),
        eq(timelineFrameExtractionOperations.requestId, owner.requestId)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function claimTimelineFrameExtractionOperation(
  input: TimelineFrameExtractionOwner & {
    inputHash: string;
    timelineFrame: number;
    operationLayer: number;
  }
): Promise<{
  created: boolean;
  acquired: boolean;
  operation: TimelineFrameExtractionOperation;
}> {
  const requestId = input.requestId.trim();
  if (!requestId || requestId.length > 160)
    throw new Error("抽帧 requestId 不合法");
  const owner = { ...input, requestId };
  const coordinates = normalizedExtractionCoordinates(input);
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withTimelineFrameExtractionMemoryLock(owner, async () => {
      const existing = memoryTimelineFrameExtractionOperation(owner);
      if (existing) {
        assertMatchingExtractionClaim(existing, input);
        if (
          existing.status !== "claimed" ||
          existing.leaseUntil.getTime() > Date.now()
        ) {
          return { created: false, acquired: false, operation: existing };
        }
        const before = { ...existing };
        existing.claimToken = randomUUID();
        existing.leaseUntil = new Date(
          Date.now() + TIMELINE_FRAME_EXTRACTION_LEASE_MS
        );
        existing.attempt += 1;
        existing.updatedAt = now();
        try {
          await persistMemoryState();
        } catch (error) {
          Object.assign(existing, before);
          throw error;
        }
        return { created: false, acquired: true, operation: existing };
      }
      const story = memoryState.stories.find(
        row => row.id === input.storyId && row.userId === input.userId
      );
      if (!story) throw new Error("Story 不存在或不属于当前用户");
      const current = now();
      const receiptRows = memoryState.timelineFrameExtractionOperations.filter(
        row => row.userId === input.userId
      );
      assertTimelineFrameExtractionReceiptQuota({
        last24Hours: receiptRows.filter(
          row => row.createdAt.getTime() >= current.getTime() - 86_400_000
        ).length,
        userTotal: receiptRows.length,
        storyTotal: receiptRows.filter(row => row.storyId === input.storyId)
          .length,
      });
      const operation: TimelineFrameExtractionOperation = {
        id: nextMemoryId("timelineFrameExtractionOperation"),
        storyId: input.storyId,
        userId: input.userId,
        requestId,
        inputHash: input.inputHash,
        ...coordinates,
        claimToken: randomUUID(),
        leaseUntil: new Date(
          current.getTime() + TIMELINE_FRAME_EXTRACTION_LEASE_MS
        ),
        attempt: 1,
        status: "claimed",
        winnerIdentity: null,
        descriptor: null,
        imageId: null,
        clipId: null,
        timelineVersion: null,
        errorCode: null,
        createdAt: current,
        updatedAt: current,
      };
      memoryState.timelineFrameExtractionOperations.push(operation);
      try {
        await persistMemoryState();
      } catch (error) {
        memoryState.timelineFrameExtractionOperations =
          memoryState.timelineFrameExtractionOperations.filter(
            row => row !== operation
          );
        throw error;
      }
      return { created: true, acquired: true, operation };
    });
  }
  return db.transaction(async tx => {
    // Fixed lock order for every claim/asset transaction: user -> Story ->
    // receipt. The user row serializes quota checks and cross-request asset
    // deduplication without requiring a schema migration.
    const [lockedUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update")
      .limit(1);
    if (!lockedUser) throw new Error("Story 不存在或不属于当前用户");
    const [story] = await tx
      .select({ id: stories.id })
      .from(stories)
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      )
      .for("update")
      .limit(1);
    if (!story) throw new Error("Story 不存在或不属于当前用户");
    const [existing] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(
        and(
          eq(timelineFrameExtractionOperations.storyId, input.storyId),
          eq(timelineFrameExtractionOperations.userId, input.userId),
          eq(timelineFrameExtractionOperations.requestId, requestId)
        )
      )
      .for("update")
      .limit(1);
    const claimToken = randomUUID();
    const leaseUntil = new Date(
      Date.now() + TIMELINE_FRAME_EXTRACTION_LEASE_MS
    );
    if (existing) {
      assertMatchingExtractionClaim(existing, input);
      if (
        existing.status !== "claimed" ||
        existing.leaseUntil.getTime() > Date.now()
      ) {
        return { created: false, acquired: false, operation: existing };
      }
      await tx
        .update(timelineFrameExtractionOperations)
        .set({
          claimToken,
          leaseUntil,
          attempt: existing.attempt + 1,
        })
        .where(eq(timelineFrameExtractionOperations.id, existing.id));
      const [reclaimed] = await tx
        .select()
        .from(timelineFrameExtractionOperations)
        .where(eq(timelineFrameExtractionOperations.id, existing.id))
        .limit(1);
      return { created: false, acquired: true, operation: reclaimed };
    }

    const cutoff = new Date(Date.now() - 86_400_000);
    const [dailyCount] = await tx
      .select({ value: sql<number>`count(*)` })
      .from(timelineFrameExtractionOperations)
      .where(
        and(
          eq(timelineFrameExtractionOperations.userId, input.userId),
          gte(timelineFrameExtractionOperations.createdAt, cutoff)
        )
      );
    const [userCount] = await tx
      .select({ value: sql<number>`count(*)` })
      .from(timelineFrameExtractionOperations)
      .where(eq(timelineFrameExtractionOperations.userId, input.userId));
    const [storyCount] = await tx
      .select({ value: sql<number>`count(*)` })
      .from(timelineFrameExtractionOperations)
      .where(
        and(
          eq(timelineFrameExtractionOperations.userId, input.userId),
          eq(timelineFrameExtractionOperations.storyId, input.storyId)
        )
      );
    assertTimelineFrameExtractionReceiptQuota({
      last24Hours: Number(dailyCount?.value ?? 0),
      userTotal: Number(userCount?.value ?? 0),
      storyTotal: Number(storyCount?.value ?? 0),
    });

    await tx.insert(timelineFrameExtractionOperations).values({
      storyId: input.storyId,
      userId: input.userId,
      requestId,
      inputHash: input.inputHash,
      ...coordinates,
      claimToken,
      leaseUntil,
      attempt: 1,
      status: "claimed",
    });
    const [operation] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(
        and(
          eq(timelineFrameExtractionOperations.storyId, input.storyId),
          eq(timelineFrameExtractionOperations.userId, input.userId),
          eq(timelineFrameExtractionOperations.requestId, requestId)
        )
      )
      .for("update")
      .limit(1);
    if (!operation) throw new Error("抽帧操作 claim 后无法读取");
    return { created: true, acquired: true, operation };
  });
}

export async function renewTimelineFrameExtractionClaim(
  input: TimelineFrameExtractionOwner & { claimToken: string }
): Promise<TimelineFrameExtractionOperation | null> {
  const renew = async (
    current: TimelineFrameExtractionOperation,
    persist: (leaseUntil: Date) => Promise<void>
  ) => {
    if (current.status !== "claimed" || current.claimToken !== input.claimToken)
      return null;
    const previousLeaseUntil = current.leaseUntil;
    const leaseUntil = new Date(
      Date.now() + TIMELINE_FRAME_EXTRACTION_LEASE_MS
    );
    current.leaseUntil = leaseUntil;
    try {
      await persist(leaseUntil);
    } catch (error) {
      current.leaseUntil = previousLeaseUntil;
      throw error;
    }
    return current;
  };
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withTimelineFrameExtractionMemoryLock(input, async () => {
      const current = memoryTimelineFrameExtractionOperation(input);
      if (!current) return null;
      return renew(current, async () => {
        current.updatedAt = now();
        await persistMemoryState();
      });
    });
  }
  return db.transaction(async tx => {
    const [current] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(
        and(
          eq(timelineFrameExtractionOperations.storyId, input.storyId),
          eq(timelineFrameExtractionOperations.userId, input.userId),
          eq(timelineFrameExtractionOperations.requestId, input.requestId)
        )
      )
      .for("update")
      .limit(1);
    if (!current) return null;
    return renew(current, leaseUntil =>
      tx
        .update(timelineFrameExtractionOperations)
        .set({ leaseUntil })
        .where(
          and(
            eq(timelineFrameExtractionOperations.id, current.id),
            eq(timelineFrameExtractionOperations.claimToken, input.claimToken),
            eq(timelineFrameExtractionOperations.status, "claimed")
          )
        )
        .then(() => undefined)
    );
  });
}

export async function recordTimelineFrameExtractionDescriptor(
  input: TimelineFrameExtractionOwner & {
    claimToken: string;
    winnerIdentity: string;
    descriptor: unknown;
  }
): Promise<TimelineFrameExtractionOperation | null> {
  const apply = async (
    current: TimelineFrameExtractionOperation,
    persist: () => Promise<void>
  ) => {
    if (current.status !== "claimed")
      throw new Error("只有 claimed 操作可以记录 descriptor");
    assertActiveExtractionClaim(current, input.claimToken);
    if (current.descriptor != null) {
      if (!extractionDescriptorMatches(current, input))
        throw new Error("抽帧 descriptor conflict");
      return current;
    }
    current.winnerIdentity = input.winnerIdentity;
    current.descriptor = input.descriptor;
    await persist();
    return current;
  };
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withTimelineFrameExtractionMemoryLock(input, async () => {
      const current = memoryTimelineFrameExtractionOperation(input);
      if (!current) return null;
      const before = { ...current };
      return apply(current, async () => {
        current.updatedAt = now();
        try {
          await persistMemoryState();
        } catch (error) {
          Object.assign(current, before);
          throw error;
        }
      });
    });
  }
  return db.transaction(async tx => {
    const [current] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(
        and(
          eq(timelineFrameExtractionOperations.storyId, input.storyId),
          eq(timelineFrameExtractionOperations.userId, input.userId),
          eq(timelineFrameExtractionOperations.requestId, input.requestId)
        )
      )
      .for("update")
      .limit(1);
    if (!current) return null;
    return apply(current, async () => {
      await tx
        .update(timelineFrameExtractionOperations)
        .set({
          winnerIdentity: input.winnerIdentity,
          descriptor: input.descriptor,
        })
        .where(eq(timelineFrameExtractionOperations.id, current.id));
    });
  });
}

export async function releaseTimelineFrameExtractionClaim(
  input: TimelineFrameExtractionOwner & { claimToken: string }
): Promise<TimelineFrameExtractionOperation | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withTimelineFrameExtractionMemoryLock(input, async () => {
      const current = memoryTimelineFrameExtractionOperation(input);
      if (!current) return null;
      if (current.status !== "claimed") return current;
      if (current.claimToken !== input.claimToken)
        throw new Error("抽帧 claim 已失效");
      const before = { ...current };
      const releasedAt = now();
      current.leaseUntil = releasedAt;
      current.updatedAt = releasedAt;
      try {
        await persistMemoryState();
      } catch (error) {
        Object.assign(current, before);
        throw error;
      }
      return current;
    });
  }
  return db.transaction(async tx => {
    const [current] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(
        and(
          eq(timelineFrameExtractionOperations.storyId, input.storyId),
          eq(timelineFrameExtractionOperations.userId, input.userId),
          eq(timelineFrameExtractionOperations.requestId, input.requestId)
        )
      )
      .for("update")
      .limit(1);
    if (!current) return null;
    if (current.status !== "claimed") return current;
    if (current.claimToken !== input.claimToken)
      throw new Error("抽帧 claim 已失效");
    const releasedAt = now();
    await tx
      .update(timelineFrameExtractionOperations)
      .set({ leaseUntil: releasedAt })
      .where(eq(timelineFrameExtractionOperations.id, current.id));
    const [released] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(eq(timelineFrameExtractionOperations.id, current.id))
      .limit(1);
    return released;
  });
}

export async function failTimelineFrameExtractionOperation(
  input: TimelineFrameExtractionOwner & {
    claimToken: string;
    errorCode: string;
  }
): Promise<TimelineFrameExtractionOperation | null> {
  const errorCode = input.errorCode.slice(0, 128);
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withTimelineFrameExtractionMemoryLock(input, async () => {
      const current = memoryTimelineFrameExtractionOperation(input);
      if (!current) return null;
      if (current.status !== "claimed")
        throw new Error("只有 claimed 操作可以标记失败");
      assertActiveExtractionClaim(current, input.claimToken);
      const before = { ...current };
      current.status = "failed";
      current.errorCode = errorCode;
      current.updatedAt = now();
      try {
        await persistMemoryState();
      } catch (error) {
        Object.assign(current, before);
        throw error;
      }
      return current;
    });
  }
  return db.transaction(async tx => {
    const [current] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(
        and(
          eq(timelineFrameExtractionOperations.storyId, input.storyId),
          eq(timelineFrameExtractionOperations.userId, input.userId),
          eq(timelineFrameExtractionOperations.requestId, input.requestId)
        )
      )
      .for("update")
      .limit(1);
    if (!current) return null;
    if (current.status !== "claimed")
      throw new Error("只有 claimed 操作可以标记失败");
    assertActiveExtractionClaim(current, input.claimToken);
    await tx
      .update(timelineFrameExtractionOperations)
      .set({ status: "failed", errorCode })
      .where(eq(timelineFrameExtractionOperations.id, current.id));
    return { ...current, status: "failed", errorCode };
  });
}

export async function settleTimelineFrameExtractionAsset(
  input: TimelineFrameExtractionOwner & {
    claimToken: string;
    existingImageId?: number;
    image?: Omit<InsertGeneratedImage, "id" | "createdAt" | "isCurrent">;
  }
): Promise<{
  operation: TimelineFrameExtractionOperation;
  image: GeneratedImage;
}> {
  if ((input.existingImageId == null) === (input.image == null)) {
    throw new Error("抽帧资产必须且只能提供 existingImageId 或 image");
  }
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withTimelineFrameExtractionMemoryLock(input, async () => {
      const operation = memoryTimelineFrameExtractionOperation(input);
      if (!operation) throw new Error("抽帧操作不存在");
      if (operation.imageId != null) {
        if (operation.status !== "asset_ready")
          throw new Error("抽帧资产状态不一致");
        const replay = memoryState.generatedImages.find(
          row =>
            row.id === operation.imageId &&
            row.storyId === input.storyId &&
            (row.userId === input.userId || row.userId == null)
        );
        if (!replay) throw new Error("抽帧操作引用的图片不存在");
        return { operation, image: replay };
      }
      if (operation.status !== "claimed")
        throw new Error("只有 claimed 操作可以登记资产");
      assertActiveExtractionClaim(operation, input.claimToken);
      const beforeOperation = { ...operation };
      let image: GeneratedImage;
      let created = false;
      if (input.existingImageId != null) {
        const existing = memoryState.generatedImages.find(
          row =>
            row.id === input.existingImageId &&
            row.storyId === input.storyId &&
            (row.userId === input.userId || row.userId == null)
        );
        if (!existing) throw new Error("复用图片不存在或不属于当前 Story");
        image = existing;
      } else {
        const data = input.image!;
        if (data.storyId !== input.storyId || data.userId !== input.userId) {
          throw new Error("新图片归属与抽帧操作不一致");
        }
        const reusable =
          data.imageKey == null
            ? undefined
            : memoryState.generatedImages.find(
                row =>
                  row.storyId === input.storyId &&
                  (row.userId === input.userId || row.userId == null) &&
                  row.imageKey === data.imageKey
              );
        image = reusable ?? {
          id: nextMemoryId("generatedImage"),
          projectId: data.projectId ?? null,
          storyId: data.storyId ?? null,
          userId: data.userId ?? null,
          shotNo: data.shotNo ?? null,
          shotIdentity: data.shotIdentity ?? null,
          imageKey: data.imageKey ?? null,
          imageUrl: data.imageUrl,
          prompt: data.prompt ?? null,
          promptCompilationId: data.promptCompilationId ?? null,
          parentImageId: data.parentImageId ?? null,
          isCurrent: false,
          generationType: data.generationType ?? "initial",
          maskKey: data.maskKey ?? null,
          createdAt: now(),
        };
        if (!reusable) {
          memoryState.generatedImages.push(image);
          created = true;
        }
      }
      operation.imageId = image.id;
      operation.status = "asset_ready";
      operation.updatedAt = now();
      try {
        // Extracted warehouse registration is authoritative in generatedImages;
        // no imageSignal is emitted here because it cannot share this local atomic write safely.
        await persistMemoryState();
      } catch (error) {
        Object.assign(operation, beforeOperation);
        if (created)
          memoryState.generatedImages = memoryState.generatedImages.filter(
            row => row !== image
          );
        throw error;
      }
      return { operation, image };
    });
  }
  return db.transaction(async tx => {
    const [lockedUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update")
      .limit(1);
    if (!lockedUser) throw new Error("抽帧操作不存在");
    const [lockedStory] = await tx
      .select({ id: stories.id })
      .from(stories)
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      )
      .for("update")
      .limit(1);
    if (!lockedStory) throw new Error("抽帧操作不存在");
    const [operation] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(
        and(
          eq(timelineFrameExtractionOperations.storyId, input.storyId),
          eq(timelineFrameExtractionOperations.userId, input.userId),
          eq(timelineFrameExtractionOperations.requestId, input.requestId)
        )
      )
      .for("update")
      .limit(1);
    if (!operation) throw new Error("抽帧操作不存在");
    if (operation.imageId != null) {
      if (operation.status !== "asset_ready")
        throw new Error("抽帧资产状态不一致");
      const [replay] = await tx
        .select()
        .from(generatedImages)
        .where(
          and(
            eq(generatedImages.id, operation.imageId),
            eq(generatedImages.storyId, input.storyId),
            or(
              eq(generatedImages.userId, input.userId),
              isNull(generatedImages.userId)
            )
          )
        )
        .limit(1);
      if (!replay) throw new Error("抽帧操作引用的图片不存在");
      return { operation, image: replay };
    }
    if (operation.status !== "claimed")
      throw new Error("只有 claimed 操作可以登记资产");
    assertActiveExtractionClaim(operation, input.claimToken);
    let image: GeneratedImage | undefined;
    if (input.existingImageId != null) {
      [image] = await tx
        .select()
        .from(generatedImages)
        .where(
          and(
            eq(generatedImages.id, input.existingImageId),
            eq(generatedImages.storyId, input.storyId),
            or(
              eq(generatedImages.userId, input.userId),
              isNull(generatedImages.userId)
            )
          )
        )
        .limit(1);
      if (!image) throw new Error("复用图片不存在或不属于当前 Story");
    } else {
      const data = input.image!;
      if (data.storyId !== input.storyId || data.userId !== input.userId)
        throw new Error("新图片归属与抽帧操作不一致");
      if (data.imageKey != null) {
        [image] = await tx
          .select()
          .from(generatedImages)
          .where(
            and(
              eq(generatedImages.storyId, input.storyId),
              or(
                eq(generatedImages.userId, input.userId),
                isNull(generatedImages.userId)
              ),
              eq(generatedImages.imageKey, data.imageKey)
            )
          )
          .limit(1);
      }
      if (!image) {
        const [inserted] = await tx
          .insert(generatedImages)
          .values({ ...data, isCurrent: false });
        [image] = await tx
          .select()
          .from(generatedImages)
          .where(eq(generatedImages.id, inserted.insertId))
          .limit(1);
      }
      if (!image) throw new Error("抽帧图片创建后无法读取");
      // Do not call createGeneratedImage: its imageSignal is a second write outside this receipt transaction.
    }
    await tx
      .update(timelineFrameExtractionOperations)
      .set({
        imageId: image.id,
        status: "asset_ready",
        errorCode: null,
      })
      .where(eq(timelineFrameExtractionOperations.id, operation.id));
    const [settled] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(eq(timelineFrameExtractionOperations.id, operation.id))
      .limit(1);
    return { operation: settled, image };
  });
}

export async function markTimelineFrameExtractionSucceeded(
  input: TimelineFrameExtractionOwner & {
    clipId: string;
    timelineVersion: number;
  }
): Promise<TimelineFrameExtractionOperation | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withTimelineFrameExtractionMemoryLock(input, async () => {
      const current = memoryTimelineFrameExtractionOperation(input);
      if (!current) return null;
      if (current.status === "succeeded") {
        if (!extractionResultMatches(current, input))
          throw new Error("抽帧成功结果 conflict");
        return current;
      }
      if (current.status !== "asset_ready" || current.imageId == null)
        throw new Error("只有 asset_ready 操作可以标记成功");
      const before = { ...current };
      current.status = "succeeded";
      current.clipId = input.clipId;
      current.timelineVersion = input.timelineVersion;
      current.errorCode = null;
      current.updatedAt = now();
      try {
        await persistMemoryState();
      } catch (error) {
        Object.assign(current, before);
        throw error;
      }
      return current;
    });
  }
  return db.transaction(async tx => {
    const [current] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(
        and(
          eq(timelineFrameExtractionOperations.storyId, input.storyId),
          eq(timelineFrameExtractionOperations.userId, input.userId),
          eq(timelineFrameExtractionOperations.requestId, input.requestId)
        )
      )
      .for("update")
      .limit(1);
    if (!current) return null;
    if (current.status === "succeeded") {
      if (!extractionResultMatches(current, input))
        throw new Error("抽帧成功结果 conflict");
      return current;
    }
    if (current.status !== "asset_ready" || current.imageId == null)
      throw new Error("只有 asset_ready 操作可以标记成功");
    await tx
      .update(timelineFrameExtractionOperations)
      .set({
        status: "succeeded",
        clipId: input.clipId,
        timelineVersion: input.timelineVersion,
        errorCode: null,
      })
      .where(eq(timelineFrameExtractionOperations.id, current.id));
    const [settled] = await tx
      .select()
      .from(timelineFrameExtractionOperations)
      .where(eq(timelineFrameExtractionOperations.id, current.id))
      .limit(1);
    return settled;
  });
}
