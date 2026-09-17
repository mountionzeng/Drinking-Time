/** Persistence operations for audioAssets. Local and MySQL behavior share this boundary. */
import { eq, and, ne } from "drizzle-orm";
import { unlink } from "node:fs/promises";
import { createKeyedSerialLock } from "../utils/keyedSerialLock";
import {
  isValidAudioStorageKey,
  resolveManagedAudioPath,
} from "../services/audioMedia";
import {
  storyAudioAssets,
  StoryAudioAsset,
  InsertStoryAudioAsset,
  storyAudioImportOperations,
  StoryAudioImportOperation,
  InsertStoryAudioImportOperation,
} from "../../drizzle/schema";
import {
  applyDefinedValues,
  ensureMemoryLoaded,
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
} from "./runtime";

// ─── Story audio assets & staged import operations (U2) ─────────────────

/**
 * Best-effort removal of managed audio bytes for a set of storage keys. Never
 * throws — a missing file or a bad key is fine; the metadata rows are already
 * gone by the time this runs.
 */
export async function removeManagedAudioFiles(
  storageKeys: readonly string[]
): Promise<void> {
  for (const key of storageKeys) {
    if (!isValidAudioStorageKey(key)) continue;
    try {
      await unlink(resolveManagedAudioPath(key));
    } catch {
      // best effort
    }
  }
}

export type StoryAudioAssetPatch = Partial<
  Pick<
    InsertStoryAudioAsset,
    | "status"
    | "failureReason"
    | "durationFrames"
    | "durationSeconds"
    | "sampleRate"
    | "channels"
    | "codecName"
    | "formatName"
    | "checksum"
    | "sourceKey"
    | "mediaKind"
    | "displayName"
    | "provenance"
  >
>;

export async function createStoryAudioAssetRow(
  data: Omit<InsertStoryAudioAsset, "id" | "createdAt" | "updatedAt">
): Promise<StoryAudioAsset> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const current = now();
    const row: StoryAudioAsset = {
      id: nextMemoryId("storyAudioAsset"),
      storyId: data.storyId,
      userId: data.userId,
      storageKey: data.storageKey,
      displayName: data.displayName,
      mediaKind: data.mediaKind ?? "unknown",
      sourceKind: data.sourceKind,
      sourceKey: data.sourceKey ?? null,
      checksum: data.checksum ?? null,
      status: data.status ?? "pending",
      failureReason: data.failureReason ?? null,
      durationFrames: data.durationFrames ?? null,
      durationSeconds: data.durationSeconds ?? null,
      sampleRate: data.sampleRate ?? null,
      channels: data.channels ?? null,
      codecName: data.codecName ?? null,
      formatName: data.formatName ?? null,
      provenance: data.provenance ?? null,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.storyAudioAssets.push(row);
    await persistMemoryState();
    return row;
  }
  const [result] = await db.insert(storyAudioAssets).values(data);
  const [row] = await db
    .select()
    .from(storyAudioAssets)
    .where(eq(storyAudioAssets.id, result.insertId));
  return row;
}

export async function updateStoryAudioAssetRow(
  assetId: number,
  userId: number,
  patch: StoryAudioAssetPatch
): Promise<StoryAudioAsset | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const row = memoryState.storyAudioAssets.find(
      asset => asset.id === assetId && asset.userId === userId
    );
    if (!row) return null;
    applyDefinedValues(
      row as unknown as Record<string, unknown>,
      patch as unknown as Record<string, unknown>
    );
    row.updatedAt = now();
    await persistMemoryState();
    return row;
  }
  await db
    .update(storyAudioAssets)
    .set(patch)
    .where(
      and(eq(storyAudioAssets.id, assetId), eq(storyAudioAssets.userId, userId))
    );
  const [row] = await db
    .select()
    .from(storyAudioAssets)
    .where(eq(storyAudioAssets.id, assetId));
  return row ?? null;
}

/** Ownership-checked read. Never trusts a bare assetId. */
export async function getStoryAudioAssetRow(input: {
  assetId: number;
  storyId: number;
  userId: number;
}): Promise<StoryAudioAsset | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.storyAudioAssets.find(
        asset =>
          asset.id === input.assetId &&
          asset.storyId === input.storyId &&
          asset.userId === input.userId
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(storyAudioAssets)
    .where(
      and(
        eq(storyAudioAssets.id, input.assetId),
        eq(storyAudioAssets.storyId, input.storyId),
        eq(storyAudioAssets.userId, input.userId)
      )
    );
  return row ?? null;
}

export async function listStoryAudioAssetRows(input: {
  storyId: number;
  userId: number;
}): Promise<StoryAudioAsset[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.storyAudioAssets
      .filter(
        asset =>
          asset.storyId === input.storyId && asset.userId === input.userId
      )
      .map(asset => ({ ...asset }));
  }
  return db
    .select()
    .from(storyAudioAssets)
    .where(
      and(
        eq(storyAudioAssets.storyId, input.storyId),
        eq(storyAudioAssets.userId, input.userId)
      )
    );
}

export async function listStoryAudioAssetRowsForUser(
  userId: number
): Promise<StoryAudioAsset[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.storyAudioAssets
      .filter(asset => asset.userId === userId)
      .map(asset => ({ ...asset }));
  }
  return db
    .select()
    .from(storyAudioAssets)
    .where(eq(storyAudioAssets.userId, userId));
}

/** A `ready` asset with the same upstream identity in the same Story, for idempotent reuse. */
export async function findReusableStoryAudioAssetRow(input: {
  storyId: number;
  userId: number;
  sourceKind: StoryAudioAsset["sourceKind"];
  sourceKey: string;
}): Promise<StoryAudioAsset | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.storyAudioAssets.find(
        asset =>
          asset.storyId === input.storyId &&
          asset.userId === input.userId &&
          asset.sourceKind === input.sourceKind &&
          asset.sourceKey === input.sourceKey &&
          asset.status === "ready"
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(storyAudioAssets)
    .where(
      and(
        eq(storyAudioAssets.storyId, input.storyId),
        eq(storyAudioAssets.userId, input.userId),
        eq(storyAudioAssets.sourceKind, input.sourceKind),
        eq(storyAudioAssets.sourceKey, input.sourceKey),
        eq(storyAudioAssets.status, "ready")
      )
    )
    .limit(1);
  return row ?? null;
}

export type StoryAudioImportOperationPatch = Partial<
  Pick<
    InsertStoryAudioImportOperation,
    "status" | "failureCode" | "stagingKey" | "assetId"
  >
>;

const storyAudioImportMemoryLock = createKeyedSerialLock<string>();

export type StoryAudioImportBundleResult =
  | {
      created: true;
      asset: StoryAudioAsset;
      operation: StoryAudioImportOperation;
    }
  | { created: false; operation: StoryAudioImportOperation };

/** Atomically creates the pending asset and its recovery source-of-truth row. */
export async function createStoryAudioImportBundle(input: {
  asset: Omit<InsertStoryAudioAsset, "id" | "createdAt" | "updatedAt">;
  operation: Omit<
    InsertStoryAudioImportOperation,
    "id" | "assetId" | "createdAt" | "updatedAt"
  >;
}): Promise<StoryAudioImportBundleResult> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const key = `${input.operation.storyId}:${input.operation.userId}:${input.operation.operationId}`;
    return storyAudioImportMemoryLock.run(key, async () => {
      const existing = memoryState.storyAudioImportOperations.find(
        op =>
          op.storyId === input.operation.storyId &&
          op.userId === input.operation.userId &&
          op.operationId === input.operation.operationId
      );
      if (existing) return { created: false, operation: { ...existing } };

      const previousAssetId = memoryState.nextIds.storyAudioAsset;
      const previousOperationId = memoryState.nextIds.storyAudioImportOperation;
      const current = now();
      const asset: StoryAudioAsset = {
        id: nextMemoryId("storyAudioAsset"),
        storyId: input.asset.storyId,
        userId: input.asset.userId,
        storageKey: input.asset.storageKey,
        displayName: input.asset.displayName,
        mediaKind: input.asset.mediaKind ?? "unknown",
        sourceKind: input.asset.sourceKind,
        sourceKey: input.asset.sourceKey ?? null,
        checksum: input.asset.checksum ?? null,
        status: input.asset.status ?? "pending",
        failureReason: input.asset.failureReason ?? null,
        durationFrames: input.asset.durationFrames ?? null,
        durationSeconds: input.asset.durationSeconds ?? null,
        sampleRate: input.asset.sampleRate ?? null,
        channels: input.asset.channels ?? null,
        codecName: input.asset.codecName ?? null,
        formatName: input.asset.formatName ?? null,
        provenance: input.asset.provenance ?? null,
        createdAt: current,
        updatedAt: current,
      };
      const operation: StoryAudioImportOperation = {
        id: nextMemoryId("storyAudioImportOperation"),
        storyId: input.operation.storyId,
        userId: input.operation.userId,
        operationId: input.operation.operationId,
        requestDigest: input.operation.requestDigest,
        assetId: asset.id,
        sourceKind: input.operation.sourceKind,
        status: input.operation.status ?? "pending",
        failureCode: input.operation.failureCode ?? null,
        stagingKey: input.operation.stagingKey ?? null,
        createdAt: current,
        updatedAt: current,
      };
      memoryState.storyAudioAssets.push(asset);
      memoryState.storyAudioImportOperations.push(operation);
      try {
        await persistMemoryState();
      } catch (error) {
        memoryState.storyAudioAssets.pop();
        memoryState.storyAudioImportOperations.pop();
        memoryState.nextIds.storyAudioAsset = previousAssetId;
        memoryState.nextIds.storyAudioImportOperation = previousOperationId;
        throw error;
      }
      return { created: true, asset, operation };
    });
  }

  try {
    return await db.transaction(async tx => {
      const [existing] = await tx
        .select()
        .from(storyAudioImportOperations)
        .where(
          and(
            eq(storyAudioImportOperations.storyId, input.operation.storyId),
            eq(storyAudioImportOperations.userId, input.operation.userId),
            eq(
              storyAudioImportOperations.operationId,
              input.operation.operationId
            )
          )
        );
      if (existing) return { created: false as const, operation: existing };

      const [assetInsert] = await tx
        .insert(storyAudioAssets)
        .values(input.asset);
      const [asset] = await tx
        .select()
        .from(storyAudioAssets)
        .where(eq(storyAudioAssets.id, assetInsert.insertId));
      const [operationInsert] = await tx
        .insert(storyAudioImportOperations)
        .values({ ...input.operation, assetId: asset.id });
      const [operation] = await tx
        .select()
        .from(storyAudioImportOperations)
        .where(eq(storyAudioImportOperations.id, operationInsert.insertId));
      return { created: true as const, asset, operation };
    });
  } catch (error) {
    const existing = await getStoryAudioImportOperationRow({
      storyId: input.operation.storyId,
      userId: input.operation.userId,
      operationId: input.operation.operationId,
    });
    if (existing) return { created: false, operation: existing };
    throw error;
  }
}

export async function createStoryAudioImportOperationRow(
  data: Omit<InsertStoryAudioImportOperation, "id" | "createdAt" | "updatedAt">
): Promise<StoryAudioImportOperation> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const current = now();
    const row: StoryAudioImportOperation = {
      id: nextMemoryId("storyAudioImportOperation"),
      storyId: data.storyId,
      userId: data.userId,
      operationId: data.operationId,
      requestDigest: data.requestDigest,
      assetId: data.assetId ?? null,
      sourceKind: data.sourceKind,
      status: data.status ?? "pending",
      failureCode: data.failureCode ?? null,
      stagingKey: data.stagingKey ?? null,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.storyAudioImportOperations.push(row);
    await persistMemoryState();
    return row;
  }
  const [result] = await db.insert(storyAudioImportOperations).values(data);
  const [row] = await db
    .select()
    .from(storyAudioImportOperations)
    .where(eq(storyAudioImportOperations.id, result.insertId));
  return row;
}

export async function getStoryAudioImportOperationRow(input: {
  storyId: number;
  userId: number;
  operationId: string;
}): Promise<StoryAudioImportOperation | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.storyAudioImportOperations.find(
        op =>
          op.storyId === input.storyId &&
          op.userId === input.userId &&
          op.operationId === input.operationId
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(storyAudioImportOperations)
    .where(
      and(
        eq(storyAudioImportOperations.storyId, input.storyId),
        eq(storyAudioImportOperations.userId, input.userId),
        eq(storyAudioImportOperations.operationId, input.operationId)
      )
    );
  return row ?? null;
}

export async function updateStoryAudioImportOperationRow(
  id: number,
  patch: StoryAudioImportOperationPatch
): Promise<StoryAudioImportOperation | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const row = memoryState.storyAudioImportOperations.find(op => op.id === id);
    if (!row) return null;
    applyDefinedValues(
      row as unknown as Record<string, unknown>,
      patch as unknown as Record<string, unknown>
    );
    row.updatedAt = now();
    await persistMemoryState();
    return row;
  }
  await db
    .update(storyAudioImportOperations)
    .set(patch)
    .where(eq(storyAudioImportOperations.id, id));
  const [row] = await db
    .select()
    .from(storyAudioImportOperations)
    .where(eq(storyAudioImportOperations.id, id));
  return row ?? null;
}

/** Operations still mid-flight, for the crash-recovery pass. */
export async function listUnsettledStoryAudioImportOperationRows(): Promise<
  StoryAudioImportOperation[]
> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.storyAudioImportOperations
      .filter(op => op.status !== "ready" && op.status !== "failed")
      .map(op => ({ ...op }));
  }
  return db
    .select()
    .from(storyAudioImportOperations)
    .where(
      and(
        ne(storyAudioImportOperations.status, "ready"),
        ne(storyAudioImportOperations.status, "failed")
      )
    );
}

/**
 * Managed audio storage keys still referenced by a Story's asset rows —
 * used by the backup script and by Story deletion to clean the real bytes.
 */
export async function listStoryAudioStorageKeysForStory(input: {
  storyId: number;
  userId: number;
}): Promise<string[]> {
  const rows = await listStoryAudioAssetRows(input);
  return rows.map(row => row.storageKey);
}
