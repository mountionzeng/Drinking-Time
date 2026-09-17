/** Persistence operations for maskedImageOperations. Local and MySQL behavior share this boundary. */
import { eq, and, desc, inArray, isNotNull, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  stories,
  InsertGeneratedImage,
  generatedImages,
  GeneratedImage,
  previewMaskedImageOperations,
  PreviewMaskedImageOperation,
} from "../../drizzle/schema";
import {
  ensureMemoryLoaded,
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
  previewMaskedImageMemoryLock,
} from "./runtime";

type PreviewMaskedImageOperationOwner = {
  storyId: number;
  userId: number;
  operationToken: string;
};

const PREVIEW_MASKED_IMAGE_LEASE_MS = 15 * 60 * 1000;

const PREVIEW_MASKED_IMAGE_PROTECTED_STATUSES: PreviewMaskedImageOperation["status"][] =
  ["claimed", "provider_accepted", "unknown", "succeeded"];

function memoryPreviewMaskedImageOperation(
  owner: PreviewMaskedImageOperationOwner
): PreviewMaskedImageOperation | null {
  return (
    memoryState.previewMaskedImageOperations.find(
      row =>
        row.storyId === owner.storyId &&
        row.userId === owner.userId &&
        row.operationToken === owner.operationToken
    ) ?? null
  );
}

function assertMatchingPreviewMaskedImageOperation(
  existing: PreviewMaskedImageOperation,
  input: {
    inputHash: string;
    sourceImageId: number;
    maskKey: string;
    targetKind: "shot-primary" | "timeline-image-clip";
    stableShotId: string;
    clipId?: string | null;
    quoteId: string;
  }
) {
  if (
    existing.inputHash !== input.inputHash ||
    existing.sourceImageId !== input.sourceImageId ||
    existing.maskKey !== input.maskKey ||
    existing.targetKind !== input.targetKind ||
    existing.stableShotId !== input.stableShotId ||
    existing.clipId !== (input.clipId ?? null) ||
    existing.quoteId !== input.quoteId
  ) {
    throw new Error("operationToken 已绑定另一组局部图片修改参数");
  }
}

export async function getPreviewMaskedImageOperation(
  owner: PreviewMaskedImageOperationOwner
): Promise<PreviewMaskedImageOperation | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryPreviewMaskedImageOperation(owner);
  }
  const [row] = await db
    .select()
    .from(previewMaskedImageOperations)
    .where(
      and(
        eq(previewMaskedImageOperations.storyId, owner.storyId),
        eq(previewMaskedImageOperations.userId, owner.userId),
        eq(previewMaskedImageOperations.operationToken, owner.operationToken)
      )
    )
    .limit(1);
  return row ?? null;
}

/** The receipt is the authoritative binding between a generated candidate and
 * the exact Preview target it was paid to edit. */
export async function getSucceededPreviewMaskedImageOperationForCandidate(input: {
  storyId: number;
  userId: number;
  candidateImageId: number;
}): Promise<PreviewMaskedImageOperation | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.previewMaskedImageOperations.find(
        row =>
          row.storyId === input.storyId &&
          row.userId === input.userId &&
          row.candidateImageId === input.candidateImageId &&
          row.status === "succeeded"
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(previewMaskedImageOperations)
    .where(
      and(
        eq(previewMaskedImageOperations.storyId, input.storyId),
        eq(previewMaskedImageOperations.userId, input.userId),
        eq(
          previewMaskedImageOperations.candidateImageId,
          input.candidateImageId
        ),
        eq(previewMaskedImageOperations.status, "succeeded")
      )
    )
    .limit(1);
  return row ?? null;
}

/** Recover the newest paid result for an unchanged Preview target. This keeps
 * succeeded, unadopted candidates available across reloads without granting
 * them any automatic adoption authority. */
export async function getLatestSucceededPreviewMaskedImageOperationForTarget(input: {
  storyId: number;
  userId: number;
  sourceImageId: number;
  targetKind: "shot-primary" | "timeline-image-clip";
  stableShotId: string;
  clipId?: string | null;
}): Promise<PreviewMaskedImageOperation | null> {
  const matches = (row: PreviewMaskedImageOperation) =>
    row.storyId === input.storyId &&
    row.userId === input.userId &&
    row.sourceImageId === input.sourceImageId &&
    row.targetKind === input.targetKind &&
    row.stableShotId === input.stableShotId &&
    row.clipId === (input.clipId ?? null) &&
    row.status === "succeeded" &&
    row.candidateImageId != null;
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.previewMaskedImageOperations
        .filter(matches)
        .sort(
          (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()
        )[0] ?? null
    );
  }
  const conditions = [
    eq(previewMaskedImageOperations.storyId, input.storyId),
    eq(previewMaskedImageOperations.userId, input.userId),
    eq(previewMaskedImageOperations.sourceImageId, input.sourceImageId),
    eq(previewMaskedImageOperations.targetKind, input.targetKind),
    eq(previewMaskedImageOperations.stableShotId, input.stableShotId),
    eq(previewMaskedImageOperations.status, "succeeded"),
    isNotNull(previewMaskedImageOperations.candidateImageId),
    input.clipId == null
      ? isNull(previewMaskedImageOperations.clipId)
      : eq(previewMaskedImageOperations.clipId, input.clipId),
  ];
  const [row] = await db
    .select()
    .from(previewMaskedImageOperations)
    .where(and(...conditions))
    .orderBy(desc(previewMaskedImageOperations.updatedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Durably fences one paid masked-edit submission. Existing receipts are never
 * automatically reacquired: a worker may have crossed the provider's billing
 * boundary before it crashed, even when no provider task id was returned.
 */
export async function claimPreviewMaskedImageOperation(
  input: PreviewMaskedImageOperationOwner & {
    inputHash: string;
    sourceImageId: number;
    maskKey: string;
    targetKind: "shot-primary" | "timeline-image-clip";
    stableShotId: string;
    clipId?: string | null;
    quoteId: string;
    currency: string;
    estimatedCny: number;
    quoteExpiresAt: Date;
  }
): Promise<{
  created: boolean;
  acquired: boolean;
  operation: PreviewMaskedImageOperation;
}> {
  const operationToken = input.operationToken.trim();
  if (!operationToken || operationToken.length > 160) {
    throw new Error("局部图片修改 operationToken 不合法");
  }
  const owner = { ...input, operationToken };
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return previewMaskedImageMemoryLock.run(String(input.userId), async () => {
      const existing = memoryPreviewMaskedImageOperation(owner);
      if (existing) {
        assertMatchingPreviewMaskedImageOperation(existing, input);
        return { created: false, acquired: false, operation: existing };
      }
      const protectedReplay = memoryState.previewMaskedImageOperations.find(
        row =>
          row.storyId === input.storyId &&
          row.userId === input.userId &&
          row.inputHash === input.inputHash &&
          PREVIEW_MASKED_IMAGE_PROTECTED_STATUSES.includes(row.status)
      );
      if (protectedReplay) {
        return { created: false, acquired: false, operation: protectedReplay };
      }
      const story = memoryState.stories.find(
        row => row.id === input.storyId && row.userId === input.userId
      );
      const source = memoryState.generatedImages.find(
        row =>
          row.id === input.sourceImageId &&
          row.storyId === input.storyId &&
          row.userId === input.userId
      );
      if (!story || !source) throw new Error("底图不存在或无权操作");
      const current = now();
      const operation: PreviewMaskedImageOperation = {
        id: nextMemoryId("previewMaskedImageOperation"),
        storyId: input.storyId,
        userId: input.userId,
        operationToken,
        inputHash: input.inputHash,
        sourceImageId: input.sourceImageId,
        maskKey: input.maskKey,
        targetKind: input.targetKind,
        stableShotId: input.stableShotId,
        clipId: input.clipId ?? null,
        quoteId: input.quoteId,
        currency: input.currency,
        estimatedCny: input.estimatedCny,
        quoteExpiresAt: input.quoteExpiresAt,
        claimToken: randomUUID(),
        leaseUntil: new Date(current.getTime() + PREVIEW_MASKED_IMAGE_LEASE_MS),
        attempt: 1,
        status: "claimed",
        providerTaskId: null,
        candidateImageId: null,
        errorCode: null,
        createdAt: current,
        updatedAt: current,
      };
      memoryState.previewMaskedImageOperations.push(operation);
      try {
        await persistMemoryState();
      } catch (error) {
        memoryState.previewMaskedImageOperations =
          memoryState.previewMaskedImageOperations.filter(
            row => row !== operation
          );
        throw error;
      }
      return { created: true, acquired: true, operation };
    });
  }
  return db.transaction(async tx => {
    const [story] = await tx
      .select({ id: stories.id })
      .from(stories)
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      )
      .for("update")
      .limit(1);
    if (!story) throw new Error("底图不存在或无权操作");
    const [existing] = await tx
      .select()
      .from(previewMaskedImageOperations)
      .where(
        and(
          eq(previewMaskedImageOperations.storyId, input.storyId),
          eq(previewMaskedImageOperations.userId, input.userId),
          eq(previewMaskedImageOperations.operationToken, operationToken)
        )
      )
      .for("update")
      .limit(1);
    if (existing) {
      assertMatchingPreviewMaskedImageOperation(existing, input);
      return { created: false, acquired: false, operation: existing };
    }
    const [protectedReplay] = await tx
      .select()
      .from(previewMaskedImageOperations)
      .where(
        and(
          eq(previewMaskedImageOperations.storyId, input.storyId),
          eq(previewMaskedImageOperations.userId, input.userId),
          eq(previewMaskedImageOperations.inputHash, input.inputHash),
          inArray(
            previewMaskedImageOperations.status,
            PREVIEW_MASKED_IMAGE_PROTECTED_STATUSES
          )
        )
      )
      .for("update")
      .limit(1);
    if (protectedReplay) {
      return { created: false, acquired: false, operation: protectedReplay };
    }
    const [source] = await tx
      .select({ id: generatedImages.id })
      .from(generatedImages)
      .where(
        and(
          eq(generatedImages.id, input.sourceImageId),
          eq(generatedImages.storyId, input.storyId),
          eq(generatedImages.userId, input.userId)
        )
      )
      .limit(1);
    if (!source) throw new Error("底图不存在或无权操作");
    const claimToken = randomUUID();
    await tx.insert(previewMaskedImageOperations).values({
      storyId: input.storyId,
      userId: input.userId,
      operationToken,
      inputHash: input.inputHash,
      sourceImageId: input.sourceImageId,
      maskKey: input.maskKey,
      targetKind: input.targetKind,
      stableShotId: input.stableShotId,
      clipId: input.clipId ?? null,
      quoteId: input.quoteId,
      currency: input.currency,
      estimatedCny: input.estimatedCny,
      quoteExpiresAt: input.quoteExpiresAt,
      claimToken,
      leaseUntil: new Date(Date.now() + PREVIEW_MASKED_IMAGE_LEASE_MS),
      attempt: 1,
      status: "claimed",
    });
    const [operation] = await tx
      .select()
      .from(previewMaskedImageOperations)
      .where(
        and(
          eq(previewMaskedImageOperations.storyId, input.storyId),
          eq(previewMaskedImageOperations.userId, input.userId),
          eq(previewMaskedImageOperations.operationToken, operationToken)
        )
      )
      .limit(1);
    if (!operation) throw new Error("局部图片修改 claim 后无法读取");
    return { created: true, acquired: true, operation };
  });
}

export async function markPreviewMaskedImageOperationAccepted(
  input: PreviewMaskedImageOperationOwner & {
    claimToken: string;
    providerTaskId: string;
  }
): Promise<PreviewMaskedImageOperation | null> {
  const apply = async (
    current: PreviewMaskedImageOperation,
    persist: () => Promise<void>
  ) => {
    if (
      current.claimToken !== input.claimToken ||
      current.status !== "claimed"
    ) {
      throw new Error("局部图片修改 claim 已失效");
    }
    current.status = "provider_accepted";
    current.providerTaskId = input.providerTaskId;
    current.updatedAt = now();
    await persist();
    return current;
  };
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return previewMaskedImageMemoryLock.run(String(input.userId), async () => {
      const current = memoryPreviewMaskedImageOperation(input);
      if (!current) return null;
      const before = { ...current };
      try {
        return await apply(current, persistMemoryState);
      } catch (error) {
        Object.assign(current, before);
        throw error;
      }
    });
  }
  return db.transaction(async tx => {
    const [current] = await tx
      .select()
      .from(previewMaskedImageOperations)
      .where(
        and(
          eq(previewMaskedImageOperations.storyId, input.storyId),
          eq(previewMaskedImageOperations.userId, input.userId),
          eq(previewMaskedImageOperations.operationToken, input.operationToken)
        )
      )
      .for("update")
      .limit(1);
    if (!current) return null;
    return apply(current, async () => {
      await tx
        .update(previewMaskedImageOperations)
        .set({
          status: "provider_accepted",
          providerTaskId: input.providerTaskId,
        })
        .where(eq(previewMaskedImageOperations.id, current.id));
    });
  });
}

export async function failPreviewMaskedImageOperation(
  input: PreviewMaskedImageOperationOwner & {
    claimToken: string;
    errorCode: string;
    providerTaskId?: string;
    submissionUncertain?: boolean;
  }
): Promise<PreviewMaskedImageOperation | null> {
  const status =
    input.submissionUncertain || input.providerTaskId ? "unknown" : "failed";
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return previewMaskedImageMemoryLock.run(String(input.userId), async () => {
      const current = memoryPreviewMaskedImageOperation(input);
      if (!current) return null;
      if (
        current.claimToken !== input.claimToken ||
        current.status === "succeeded"
      ) {
        throw new Error("局部图片修改 claim 已失效");
      }
      const before = { ...current };
      current.status = status;
      current.providerTaskId = input.providerTaskId ?? current.providerTaskId;
      current.errorCode = input.errorCode.slice(0, 128);
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
      .from(previewMaskedImageOperations)
      .where(
        and(
          eq(previewMaskedImageOperations.storyId, input.storyId),
          eq(previewMaskedImageOperations.userId, input.userId),
          eq(previewMaskedImageOperations.operationToken, input.operationToken)
        )
      )
      .for("update")
      .limit(1);
    if (!current) return null;
    if (
      current.claimToken !== input.claimToken ||
      current.status === "succeeded"
    ) {
      throw new Error("局部图片修改 claim 已失效");
    }
    await tx
      .update(previewMaskedImageOperations)
      .set({
        status,
        providerTaskId: input.providerTaskId ?? current.providerTaskId,
        errorCode: input.errorCode.slice(0, 128),
      })
      .where(eq(previewMaskedImageOperations.id, current.id));
    return { ...current, status, errorCode: input.errorCode.slice(0, 128) };
  });
}

export async function settlePreviewMaskedImageOperationSuccess(
  input: PreviewMaskedImageOperationOwner & {
    claimToken: string;
    image: Omit<InsertGeneratedImage, "id" | "createdAt">;
  }
): Promise<{
  operation: PreviewMaskedImageOperation;
  image: GeneratedImage;
}> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return previewMaskedImageMemoryLock.run(String(input.userId), async () => {
      const operation = memoryPreviewMaskedImageOperation(input);
      if (!operation) throw new Error("局部图片修改操作不存在");
      if (operation.candidateImageId != null) {
        const replay = memoryState.generatedImages.find(
          image => image.id === operation.candidateImageId
        );
        if (!replay) throw new Error("局部图片修改候选不存在");
        return { operation, image: replay };
      }
      if (
        operation.claimToken !== input.claimToken ||
        !["claimed", "provider_accepted"].includes(operation.status)
      ) {
        throw new Error("局部图片修改 claim 已失效");
      }
      if (
        input.image.storyId !== input.storyId ||
        input.image.userId !== input.userId ||
        input.image.parentImageId !== operation.sourceImageId ||
        input.image.maskKey !== operation.maskKey ||
        input.image.isCurrent !== false
      ) {
        throw new Error("局部图片修改候选归属不一致");
      }
      const image: GeneratedImage = {
        id: nextMemoryId("generatedImage"),
        projectId: input.image.projectId ?? null,
        storyId: input.image.storyId ?? null,
        userId: input.image.userId ?? null,
        shotNo: input.image.shotNo ?? null,
        shotIdentity: input.image.shotIdentity ?? null,
        imageKey: input.image.imageKey ?? null,
        imageUrl: input.image.imageUrl,
        prompt: input.image.prompt ?? null,
        promptCompilationId: input.image.promptCompilationId ?? null,
        parentImageId: input.image.parentImageId ?? null,
        isCurrent: false,
        generationType: input.image.generationType ?? "inpaint",
        maskKey: input.image.maskKey ?? null,
        createdAt: now(),
      };
      const beforeOperation = { ...operation };
      memoryState.generatedImages.push(image);
      operation.status = "succeeded";
      operation.candidateImageId = image.id;
      operation.errorCode = null;
      operation.updatedAt = now();
      try {
        await persistMemoryState();
      } catch (error) {
        memoryState.generatedImages = memoryState.generatedImages.filter(
          row => row !== image
        );
        Object.assign(operation, beforeOperation);
        throw error;
      }
      return { operation, image };
    });
  }
  return db.transaction(async tx => {
    const [operation] = await tx
      .select()
      .from(previewMaskedImageOperations)
      .where(
        and(
          eq(previewMaskedImageOperations.storyId, input.storyId),
          eq(previewMaskedImageOperations.userId, input.userId),
          eq(previewMaskedImageOperations.operationToken, input.operationToken)
        )
      )
      .for("update")
      .limit(1);
    if (!operation) throw new Error("局部图片修改操作不存在");
    if (operation.candidateImageId != null) {
      const [replay] = await tx
        .select()
        .from(generatedImages)
        .where(eq(generatedImages.id, operation.candidateImageId))
        .limit(1);
      if (!replay) throw new Error("局部图片修改候选不存在");
      return { operation, image: replay };
    }
    if (
      operation.claimToken !== input.claimToken ||
      !["claimed", "provider_accepted"].includes(operation.status) ||
      input.image.storyId !== input.storyId ||
      input.image.userId !== input.userId ||
      input.image.parentImageId !== operation.sourceImageId ||
      input.image.maskKey !== operation.maskKey ||
      input.image.isCurrent !== false
    ) {
      throw new Error("局部图片修改候选归属不一致或 claim 已失效");
    }
    const [result] = await tx.insert(generatedImages).values(input.image);
    await tx
      .update(previewMaskedImageOperations)
      .set({
        status: "succeeded",
        candidateImageId: result.insertId,
        errorCode: null,
      })
      .where(eq(previewMaskedImageOperations.id, operation.id));
    const [image] = await tx
      .select()
      .from(generatedImages)
      .where(eq(generatedImages.id, result.insertId))
      .limit(1);
    if (!image) throw new Error("局部图片修改候选保存后无法读取");
    return {
      operation: {
        ...operation,
        status: "succeeded",
        candidateImageId: image.id,
      },
      image,
    };
  });
}
