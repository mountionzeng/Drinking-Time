import { and, desc, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  chapterDeliveryAssets,
  chapterDeliveries,
  chapterPackages,
  users,
  type ChapterDelivery,
  type ChapterDeliveryAsset,
  type ChapterPackageRecord,
} from "../../drizzle/schema";
import type { ChapterPackage } from "../../shared/chapterPackage";
import {
  getDb,
  memoryState,
  nextMemoryId,
  persistMemoryState,
  withLocalAggregateMutationLock,
} from "./runtime";

const conflict = (message = "这次投递请求与已有请求不一致") =>
  new TRPCError({ code: "CONFLICT", message });

export type StartChapterDelivery = {
  package: ChapterPackage;
  packageHash: string;
  requestHash: string;
  assets: Array<Pick<ChapterDeliveryAsset, "assetId" | "sha256" | "mime" | "bytes">>;
  dailyLimit?: { since: Date; until: Date; maximum: number };
};

export type ChapterDeliveryBundle = {
  delivery: ChapterDelivery;
  package: ChapterPackageRecord;
  assets: ChapterDeliveryAsset[];
  repeated: boolean;
};

async function persistLocal<T>(run: () => T, undo: () => void): Promise<T> {
  const result = run();
  try {
    await persistMemoryState();
  } catch (error) {
    undo();
    throw error;
  }
  return result;
}

export async function findChapterDeliveryByRequest(
  senderUserId: number,
  requestId: string
): Promise<ChapterDelivery | null> {
  const db = await getDb();
  if (db) {
    const [row] = await db.select().from(chapterDeliveries).where(and(
      eq(chapterDeliveries.senderUserId, senderUserId),
      eq(chapterDeliveries.requestId, requestId),
    )).limit(1);
    return row ?? null;
  }
  const row = memoryState.chapterDeliveries.find(item =>
    item.senderUserId === senderUserId && item.requestId === requestId
  );
  return row ? structuredClone(row) : null;
}

export async function getChapterDelivery(deliveryId: string): Promise<ChapterDelivery | null> {
  const db = await getDb();
  if (db) {
    const [row] = await db.select().from(chapterDeliveries)
      .where(eq(chapterDeliveries.deliveryId, deliveryId)).limit(1);
    return row ?? null;
  }
  const row = memoryState.chapterDeliveries.find(item => item.deliveryId === deliveryId);
  return row ? structuredClone(row) : null;
}

export async function findDeliveryByClaimTokenHash(tokenHash: string): Promise<ChapterDelivery | null> {
  const db = await getDb();
  if (db) {
    const [row] = await db.select().from(chapterDeliveries)
      .where(eq(chapterDeliveries.claimTokenHash, tokenHash)).limit(1);
    return row ?? null;
  }
  const row = memoryState.chapterDeliveries.find(item => item.claimTokenHash === tokenHash);
  return row ? structuredClone(row) : null;
}

export async function getChapterPackage(packageId: string): Promise<ChapterPackageRecord | null> {
  const db = await getDb();
  if (db) {
    const [row] = await db.select().from(chapterPackages)
      .where(eq(chapterPackages.packageId, packageId)).limit(1);
    return row ?? null;
  }
  const row = memoryState.chapterPackages.find(item => item.packageId === packageId);
  return row ? structuredClone(row) : null;
}

export async function listChapterDeliveryAssets(packageId: string): Promise<ChapterDeliveryAsset[]> {
  const db = await getDb();
  if (db)
    return db.select().from(chapterDeliveryAssets)
      .where(eq(chapterDeliveryAssets.packageId, packageId));
  return memoryState.chapterDeliveryAssets
    .filter(item => item.packageId === packageId)
    .map(item => structuredClone(item));
}

/** Persist package, manifest, and delivery together; duplicate request ids are idempotent. */
export async function startChapterDelivery(
  input: StartChapterDelivery & {
    row: ChapterDelivery;
    packageExpiresAt: Date;
  }
): Promise<ChapterDeliveryBundle> {
  const db = await getDb();
  if (db) {
    return db.transaction(async tx => {
      if (input.dailyLimit) {
        // Acquire the stable account lock before the idempotency lookup. That
        // prevents simultaneous inserts with distinct request ids from
        // holding adjacent unique-index gaps while waiting on the quota lock.
        const [sender] = await tx.select({ id: users.id }).from(users)
          .where(eq(users.id, input.row.senderUserId)).limit(1).for("update");
        if (!sender) throw new Error("chapter_delivery_sender_missing");
      }
      const [prior] = await tx.select().from(chapterDeliveries).where(and(
        eq(chapterDeliveries.senderUserId, input.row.senderUserId),
        eq(chapterDeliveries.requestId, input.row.requestId),
      )).limit(1).for("update");
      if (prior) {
        if (prior.requestHash !== input.requestHash) throw conflict();
        const [pkg] = await tx.select().from(chapterPackages)
          .where(eq(chapterPackages.packageId, prior.packageId)).limit(1);
        if (!pkg) throw new Error("chapter_delivery_package_missing");
        const assets = await tx.select().from(chapterDeliveryAssets)
          .where(eq(chapterDeliveryAssets.packageId, prior.packageId));
        return { delivery: prior, package: pkg, assets, repeated: true };
      }

      if (input.dailyLimit) {
        const recent = await tx.select({ id: chapterDeliveries.deliveryId }).from(chapterDeliveries)
          .where(and(
            eq(chapterDeliveries.senderUserId, input.row.senderUserId),
            sql`UNIX_TIMESTAMP(${chapterDeliveries.createdAt}) >= TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', UTC_DATE())`,
            sql`UNIX_TIMESTAMP(${chapterDeliveries.createdAt}) < TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', UTC_DATE()) + 86400`,
            ne(chapterDeliveries.status, "expired"),
          )).for("update");
        if (recent.length >= input.dailyLimit.maximum)
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "今天的章节投递次数已达到上限" });
      }

      const [existingPackage] = await tx.select().from(chapterPackages)
        .where(eq(chapterPackages.packageId, input.package.packageId)).limit(1).for("update");
      if (existingPackage && (
        existingPackage.senderUserId !== input.row.senderUserId ||
        existingPackage.packageHash !== input.packageHash
      )) throw conflict("这个章节包编号已用于其他内容");
      if (!existingPackage) {
        await tx.insert(chapterPackages).values({
          packageId: input.package.packageId,
          rootPackageId: input.package.lineage.rootPackageId,
          parentPackageId: input.package.lineage.parentPackageId,
          senderUserId: input.row.senderUserId,
          packageHash: input.packageHash,
          packageJson: input.package,
          createdAt: input.row.createdAt,
          expiresAt: input.packageExpiresAt,
        });
      }

      const existingAssets = await tx.select().from(chapterDeliveryAssets)
        .where(eq(chapterDeliveryAssets.packageId, input.package.packageId)).for("update");
      const existingById = new Map(existingAssets.map(asset => [asset.assetId, asset]));
      for (const asset of input.assets) {
        const priorAsset = existingById.get(asset.assetId);
        if (priorAsset) {
          if (priorAsset.sha256 !== asset.sha256 || priorAsset.mime !== asset.mime || priorAsset.bytes !== asset.bytes)
            throw conflict("图片清单与已有章节包不一致");
          continue;
        }
        await tx.insert(chapterDeliveryAssets).values({
          packageId: input.package.packageId,
          assetId: asset.assetId,
          sha256: asset.sha256,
          mime: asset.mime,
          bytes: asset.bytes,
          storageKey: null,
          uploadTokenHash: null,
          uploadExpiresAt: null,
          uploadedAt: null,
        });
      }
      const allAssets = await tx.select().from(chapterDeliveryAssets)
        .where(eq(chapterDeliveryAssets.packageId, input.package.packageId));
      if (allAssets.length !== input.assets.length && existingAssets.length === 0)
        throw conflict("章节包的图片清单不完整");
      const readyAt = allAssets.every(asset => Boolean(asset.storageKey)) ? input.row.createdAt : null;
      await tx.insert(chapterDeliveries).values({ ...input.row, readyAt });
      const [delivery] = await tx.select().from(chapterDeliveries)
        .where(eq(chapterDeliveries.deliveryId, input.row.deliveryId)).limit(1);
      const [pkg] = await tx.select().from(chapterPackages)
        .where(eq(chapterPackages.packageId, input.package.packageId)).limit(1);
      if (!delivery || !pkg) throw new Error("chapter_delivery_write_missing");
      return { delivery, package: pkg, assets: allAssets, repeated: false };
    });
  }

  return withLocalAggregateMutationLock(async () => {
    const prior = memoryState.chapterDeliveries.find(row =>
      row.senderUserId === input.row.senderUserId && row.requestId === input.row.requestId
    );
    if (prior) {
      if (prior.requestHash !== input.requestHash) throw conflict();
      const pkg = memoryState.chapterPackages.find(row => row.packageId === prior.packageId);
      if (!pkg) throw new Error("chapter_delivery_package_missing");
      return {
        delivery: structuredClone(prior),
        package: structuredClone(pkg),
        assets: memoryState.chapterDeliveryAssets.filter(row => row.packageId === prior.packageId).map(row => structuredClone(row)),
        repeated: true,
      };
    }
    if (input.dailyLimit) {
      const sent = memoryState.chapterDeliveries.filter(row =>
        row.senderUserId === input.row.senderUserId && row.status !== "expired" &&
        row.createdAt >= input.dailyLimit!.since && row.createdAt < input.dailyLimit!.until
      ).length;
      if (sent >= input.dailyLimit.maximum)
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "今天的章节投递次数已达到上限" });
    }
    const oldPackages = memoryState.chapterPackages;
    const oldDeliveries = memoryState.chapterDeliveries;
    const oldAssets = memoryState.chapterDeliveryAssets;
    const current = input.row.createdAt;
    const existingPackage = memoryState.chapterPackages.find(row => row.packageId === input.package.packageId);
    if (existingPackage && (
      existingPackage.senderUserId !== input.row.senderUserId ||
      existingPackage.packageHash !== input.packageHash
    )) throw conflict("这个章节包编号已用于其他内容");
    const pkg: ChapterPackageRecord = existingPackage ?? {
      packageId: input.package.packageId,
      rootPackageId: input.package.lineage.rootPackageId,
      parentPackageId: input.package.lineage.parentPackageId,
      senderUserId: input.row.senderUserId,
      packageHash: input.packageHash,
      packageJson: structuredClone(input.package),
      createdAt: current,
      expiresAt: input.packageExpiresAt,
    };
    const existingAssets = memoryState.chapterDeliveryAssets.filter(row => row.packageId === input.package.packageId);
    const byId = new Map(existingAssets.map(asset => [asset.assetId, asset]));
    for (const asset of input.assets) {
      const old = byId.get(asset.assetId);
      if (old) {
        if (old.sha256 !== asset.sha256 || old.mime !== asset.mime || old.bytes !== asset.bytes)
          throw conflict("图片清单与已有章节包不一致");
        continue;
      }
      byId.set(asset.assetId, {
        id: nextMemoryId("chapterDeliveryAsset"),
        packageId: input.package.packageId,
        ...asset,
        storageKey: null,
        uploadTokenHash: null,
        uploadExpiresAt: null,
        uploadedAt: null,
        createdAt: current,
      });
    }
    const assets = [...byId.values()];
    if (assets.length !== input.assets.length && existingAssets.length === 0)
      throw conflict("章节包的图片清单不完整");
    const readyAt = assets.every(asset => Boolean(asset.storageKey)) ? current : null;
    const delivery: ChapterDelivery = { ...input.row, readyAt, updatedAt: current };
    const result = {
      delivery: structuredClone(delivery),
      package: structuredClone(pkg),
      assets: assets.map(asset => structuredClone(asset)),
      repeated: false,
    };
    await persistLocal(
      () => {
        memoryState.chapterPackages = existingPackage ? oldPackages : [...oldPackages, pkg];
        memoryState.chapterDeliveryAssets = [...oldAssets.filter(row => row.packageId !== input.package.packageId), ...assets];
        memoryState.chapterDeliveries = [...oldDeliveries, delivery];
      },
      () => {
        memoryState.chapterPackages = oldPackages;
        memoryState.chapterDeliveryAssets = oldAssets;
        memoryState.chapterDeliveries = oldDeliveries;
      }
    );
    return result;
  });
}

export async function setChapterAssetUploadTicket(input: {
  packageId: string;
  assetId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<boolean> {
  const db = await getDb();
  if (db) {
    const result = await db.update(chapterDeliveryAssets).set({
      uploadTokenHash: input.tokenHash,
      uploadExpiresAt: input.expiresAt,
    }).where(and(
      eq(chapterDeliveryAssets.packageId, input.packageId),
      eq(chapterDeliveryAssets.assetId, input.assetId),
      isNull(chapterDeliveryAssets.storageKey),
    ));
    return result[0].affectedRows === 1;
  }
  return withLocalAggregateMutationLock(async () => {
    const row = memoryState.chapterDeliveryAssets.find(item =>
      item.packageId === input.packageId && item.assetId === input.assetId && !item.storageKey
    );
    if (!row) return false;
    const old = { ...row };
    return persistLocal(
      () => {
        row.uploadTokenHash = input.tokenHash;
        row.uploadExpiresAt = input.expiresAt;
        return true;
      },
      () => Object.assign(row, old)
    );
  });
}

export async function findChapterAssetUpload(tokenHash: string): Promise<ChapterDeliveryAsset | null> {
  const db = await getDb();
  if (db) {
    const [row] = await db.select().from(chapterDeliveryAssets)
      .where(eq(chapterDeliveryAssets.uploadTokenHash, tokenHash)).limit(1);
    return row ?? null;
  }
  const row = memoryState.chapterDeliveryAssets.find(item => item.uploadTokenHash === tokenHash);
  return row ? structuredClone(row) : null;
}

/** Record a verified immutable object and reveal the package only when every asset is present. */
export async function completeChapterAssetUpload(input: {
  packageId: string;
  assetId: string;
  tokenHash: string;
  storageKey: string;
  uploadedAt: Date;
}): Promise<"uploaded" | "repeated" | "invalid"> {
  const db = await getDb();
  if (db) {
    return db.transaction(async tx => {
      const [asset] = await tx.select().from(chapterDeliveryAssets).where(and(
        eq(chapterDeliveryAssets.packageId, input.packageId),
        eq(chapterDeliveryAssets.assetId, input.assetId),
      )).limit(1).for("update");
      if (!asset || asset.uploadTokenHash !== input.tokenHash || !asset.uploadExpiresAt || asset.uploadExpiresAt <= input.uploadedAt)
        return asset?.storageKey === input.storageKey ? "repeated" : "invalid";
      if (asset.storageKey) return asset.storageKey === input.storageKey ? "repeated" : "invalid";
      await tx.update(chapterDeliveryAssets).set({ storageKey: input.storageKey, uploadedAt: input.uploadedAt })
        .where(and(eq(chapterDeliveryAssets.packageId, input.packageId), eq(chapterDeliveryAssets.assetId, input.assetId)));
      const all = await tx.select().from(chapterDeliveryAssets)
        .where(eq(chapterDeliveryAssets.packageId, input.packageId));
      if (all.every(item => item.storageKey || (item.packageId === input.packageId && item.assetId === input.assetId))) {
        await tx.update(chapterDeliveries).set({ readyAt: input.uploadedAt })
          .where(and(eq(chapterDeliveries.packageId, input.packageId), isNull(chapterDeliveries.readyAt)));
      }
      return "uploaded";
    });
  }
  return withLocalAggregateMutationLock(async () => {
    const asset = memoryState.chapterDeliveryAssets.find(item =>
      item.packageId === input.packageId && item.assetId === input.assetId
    );
    if (!asset || asset.uploadTokenHash !== input.tokenHash || !asset.uploadExpiresAt || asset.uploadExpiresAt <= input.uploadedAt)
      return asset?.storageKey === input.storageKey ? "repeated" : "invalid";
    if (asset.storageKey) return asset.storageKey === input.storageKey ? "repeated" : "invalid";
    const oldAsset = { ...asset };
    const oldDeliveries = memoryState.chapterDeliveries;
    const allReady = memoryState.chapterDeliveryAssets.filter(item => item.packageId === input.packageId)
      .every(item => item.storageKey || item.assetId === input.assetId);
    return persistLocal(
      () => {
        asset.storageKey = input.storageKey;
        asset.uploadedAt = input.uploadedAt;
        if (allReady) memoryState.chapterDeliveries = memoryState.chapterDeliveries.map(delivery =>
          delivery.packageId === input.packageId && !delivery.readyAt
            ? { ...delivery, readyAt: input.uploadedAt, updatedAt: input.uploadedAt }
            : delivery
        );
        return "uploaded" as const;
      },
      () => {
        Object.assign(asset, oldAsset);
        memoryState.chapterDeliveries = oldDeliveries;
      }
    );
  });
}

export async function claimChapterDelivery(input: {
  deliveryId: string;
  tokenHash: string;
  userId: number;
  now: Date;
}): Promise<ChapterDelivery | null> {
  const db = await getDb();
  if (db) {
    return db.transaction(async tx => {
      const [row] = await tx.select().from(chapterDeliveries)
        .where(eq(chapterDeliveries.deliveryId, input.deliveryId)).limit(1).for("update");
      if (!row || row.kind !== "send" || row.status !== "pending" || !row.readyAt || row.expiresAt <= input.now)
        return null;
      if (row.recipientUserId === input.userId) return row;
      if (row.recipientUserId !== null || row.claimTokenHash !== input.tokenHash || !row.claimExpiresAt || row.claimExpiresAt <= input.now)
        return null;
      await tx.update(chapterDeliveries).set({ recipientUserId: input.userId, updatedAt: input.now })
        .where(and(eq(chapterDeliveries.deliveryId, input.deliveryId), isNull(chapterDeliveries.recipientUserId)));
      const [claimed] = await tx.select().from(chapterDeliveries)
        .where(eq(chapterDeliveries.deliveryId, input.deliveryId)).limit(1);
      return claimed ?? null;
    });
  }
  return withLocalAggregateMutationLock(async () => {
    const row = memoryState.chapterDeliveries.find(item => item.deliveryId === input.deliveryId);
    if (!row || row.kind !== "send" || row.status !== "pending" || !row.readyAt || row.expiresAt <= input.now)
      return null;
    if (row.recipientUserId === input.userId) return structuredClone(row);
    if (row.recipientUserId !== null || row.claimTokenHash !== input.tokenHash || !row.claimExpiresAt || row.claimExpiresAt <= input.now)
      return null;
    const old = { ...row };
    return persistLocal(
      () => {
        row.recipientUserId = input.userId;
        row.updatedAt = input.now;
        return structuredClone(row);
      },
      () => Object.assign(row, old)
    );
  });
}

export async function expireChapterDeliveries(nowAt: Date): Promise<void> {
  const db = await getDb();
  if (db) {
    await db.update(chapterDeliveries).set({ status: "expired", updatedAt: nowAt }).where(and(
      eq(chapterDeliveries.status, "pending"),
      or(lt(chapterDeliveries.expiresAt, nowAt), and(isNull(chapterDeliveries.recipientUserId), lt(chapterDeliveries.claimExpiresAt, nowAt))),
    ));
    return;
  }
  await withLocalAggregateMutationLock(async () => {
    const before = memoryState.chapterDeliveries;
    const next = before.map(row => row.status === "pending" && (
      row.expiresAt <= nowAt || (row.recipientUserId === null && row.claimExpiresAt !== null && row.claimExpiresAt <= nowAt)
    ) ? { ...row, status: "expired" as const, updatedAt: nowAt } : row);
    await persistLocal(() => { memoryState.chapterDeliveries = next; }, () => { memoryState.chapterDeliveries = before; });
  });
}

export async function listChapterInbox(userId: number, limit = 100): Promise<ChapterDelivery[]> {
  const db = await getDb();
  if (db)
    return db.select().from(chapterDeliveries).where(and(
      eq(chapterDeliveries.recipientUserId, userId),
      ne(chapterDeliveries.status, "expired"),
      gt(chapterDeliveries.expiresAt, new Date()),
      // Uploading packages are never visible to recipients.
      // readyAt is checked by the service before returning package content.
    )).orderBy(desc(chapterDeliveries.createdAt)).limit(limit);
  return memoryState.chapterDeliveries.filter(row => row.recipientUserId === userId && row.status !== "expired" && row.expiresAt > new Date())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit).map(row => structuredClone(row));
}

export async function listChapterDeliveryRowsForUser(userId: number, since: Date): Promise<ChapterDelivery[]> {
  const db = await getDb();
  if (db)
    return db.select().from(chapterDeliveries).where(and(
      or(eq(chapterDeliveries.senderUserId, userId), eq(chapterDeliveries.recipientUserId, userId)),
      gt(chapterDeliveries.createdAt, since),
      ne(chapterDeliveries.status, "expired"),
    ));
  return memoryState.chapterDeliveries.filter(row =>
    (row.senderUserId === userId || row.recipientUserId === userId) && row.createdAt > since && row.status !== "expired"
  ).map(row => structuredClone(row));
}

export async function setChapterDeliveryStatus(input: {
  deliveryId: string;
  actorUserId: number;
  status: "kept" | "appended" | "adopted" | "declined";
  now: Date;
}): Promise<ChapterDelivery | null> {
  const db = await getDb();
  if (db) {
    return db.transaction(async tx => {
      const [row] = await tx.select().from(chapterDeliveries)
        .where(eq(chapterDeliveries.deliveryId, input.deliveryId)).limit(1).for("update");
      if (!row || row.recipientUserId !== input.actorUserId || !row.readyAt || row.status === "expired") return null;
      const valid = row.kind === "send"
        ? ["kept", "appended"].includes(input.status)
        : ["adopted", "declined"].includes(input.status);
      if (!valid) return null;
      if (row.status === input.status) return row;
      if (row.status !== "pending" || row.expiresAt <= input.now) return null;
      await tx.update(chapterDeliveries).set({ status: input.status, updatedAt: input.now })
        .where(and(eq(chapterDeliveries.deliveryId, input.deliveryId), eq(chapterDeliveries.status, "pending")));
      const [updated] = await tx.select().from(chapterDeliveries)
        .where(eq(chapterDeliveries.deliveryId, input.deliveryId)).limit(1);
      return updated ?? null;
    });
  }
  return withLocalAggregateMutationLock(async () => {
    const row = memoryState.chapterDeliveries.find(item => item.deliveryId === input.deliveryId);
    if (!row || row.recipientUserId !== input.actorUserId || !row.readyAt || row.status === "expired") return null;
    const valid = row.kind === "send"
      ? ["kept", "appended"].includes(input.status)
      : ["adopted", "declined"].includes(input.status);
    if (!valid) return null;
    if (row.status === input.status) return structuredClone(row);
    if (row.status !== "pending" || row.expiresAt <= input.now) return null;
    const old = { ...row };
    return persistLocal(
      () => { row.status = input.status; row.updatedAt = input.now; return structuredClone(row); },
      () => Object.assign(row, old)
    );
  });
}

export async function findRootPackageDelivery(input: {
  rootPackageId: string;
  parentPackageId: string;
  recipientUserId: number;
  }): Promise<{ root: ChapterPackageRecord; parent: ChapterPackageRecord; originalDelivery: ChapterDelivery } | null> {
  const db = await getDb();
  if (db) {
    const [root] = await db.select().from(chapterPackages)
      .where(eq(chapterPackages.packageId, input.rootPackageId)).limit(1);
    const [parent] = await db.select().from(chapterPackages)
      .where(eq(chapterPackages.packageId, input.parentPackageId)).limit(1);
    if (!root || !parent || parent.rootPackageId !== root.packageId) return null;
    const [originalDelivery] = await db.select().from(chapterDeliveries).where(and(
      eq(chapterDeliveries.packageId, parent.packageId),
      eq(chapterDeliveries.senderUserId, parent.senderUserId),
      eq(chapterDeliveries.recipientUserId, input.recipientUserId),
      ne(chapterDeliveries.status, "expired"),
    )).limit(1);
    return originalDelivery ? { root, parent, originalDelivery } : null;
  }
  const root = memoryState.chapterPackages.find(row => row.packageId === input.rootPackageId);
  const parent = memoryState.chapterPackages.find(row => row.packageId === input.parentPackageId);
  if (!root || !parent || parent.rootPackageId !== root.packageId) return null;
  const originalDelivery = memoryState.chapterDeliveries.find(row =>
    row.packageId === parent.packageId && row.senderUserId === parent.senderUserId &&
    row.recipientUserId === input.recipientUserId && row.status !== "expired"
  );
  return originalDelivery ? {
    root: structuredClone(root), parent: structuredClone(parent), originalDelivery: structuredClone(originalDelivery),
  } : null;
}

export async function listPackageDeliveries(packageId: string): Promise<ChapterDelivery[]> {
  const db = await getDb();
  if (db)
    return db.select().from(chapterDeliveries).where(eq(chapterDeliveries.packageId, packageId));
  return memoryState.chapterDeliveries.filter(row => row.packageId === packageId).map(row => structuredClone(row));
}

export async function setReturnDeliveryStatusByPackage(input: {
  packageId: string;
  recipientUserId: number;
  status: "adopted" | "declined";
  now: Date;
}): Promise<void> {
  const rows = await listPackageDeliveries(input.packageId);
  for (const row of rows) {
    if (row.kind !== "return" || row.recipientUserId !== input.recipientUserId || row.status !== "pending") continue;
    await setChapterDeliveryStatus({
      deliveryId: row.deliveryId,
      actorUserId: input.recipientUserId,
      status: input.status,
      now: input.now,
    });
  }
}

export async function findWechatAccountForDelivery(subject: string): Promise<number | null> {
  const db = await getDb();
  const { accountIdentities } = await import("../../drizzle/schema");
  if (db) {
    const [row] = await db.select({ userId: accountIdentities.userId, subject: accountIdentities.subject })
      .from(accountIdentities).where(and(
        eq(accountIdentities.provider, "wechat"),
        eq(accountIdentities.subject, subject),
      )).limit(1);
    if (row && row.subject !== subject) throw new Error("wechat_identity_collision");
    return row?.userId ?? null;
  }
  const row = memoryState.accountIdentities.find(item => item.provider === "wechat" && item.subject === subject);
  if (row && row.subject !== subject) throw new Error("wechat_identity_collision");
  return row?.userId ?? null;
}

export async function canDeliverChapterTo(senderUserId: number, recipientUserId: number): Promise<boolean> {
  if (senderUserId === recipientUserId) return false;
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await listChapterDeliveryRowsForUser(senderUserId, cutoff);
  const sent = rows.some(row => row.senderUserId === senderUserId && row.recipientUserId === recipientUserId);
  const received = rows.some(row => row.senderUserId === recipientUserId && row.recipientUserId === senderUserId);
  return sent && received;
}

export async function allowedChapterRecipientIds(senderUserId: number): Promise<number[]> {
  const rows = await listChapterDeliveryRowsForUser(senderUserId, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const sent = new Set(rows.filter(row => row.senderUserId === senderUserId && row.recipientUserId !== null)
    .map(row => row.recipientUserId!));
  const received = new Set(rows.filter(row => row.recipientUserId === senderUserId)
    .map(row => row.senderUserId));
  return [...sent].filter(userId => received.has(userId)).sort((a, b) => a - b);
}
