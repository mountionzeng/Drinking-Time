import { and, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  artworkShares,
  stories,
  type ArtworkShare,
} from "../../drizzle/schema";
import {
  getDb,
  memoryState,
  persistMemoryState,
  withLocalAggregateMutationLock,
} from "./runtime";

const missing = () =>
  new TRPCError({ code: "NOT_FOUND", message: "作品不存在或分享已停止" });
function checkReplay(existing: ArtworkShare, row: ArtworkShare) {
  if (
    existing.userId !== row.userId ||
    existing.storyId !== row.storyId ||
    existing.fingerprint !== row.fingerprint ||
    existing.revokedAt
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "分享内容已变化，请重新打开分享预览",
    });
}
export async function saveArtworkShare(row: ArtworkShare) {
  const db = await getDb();
  if (db)
    return db.transaction(async tx => {
      // Serialize creates for this story; both ownership and quota are checked under the lock.
      const [story] = await tx
        .select({ id: stories.id })
        .from(stories)
        .where(and(eq(stories.id, row.storyId), eq(stories.userId, row.userId)))
        .for("update");
      if (!story) throw missing();
      const [existing] = await tx
        .select()
        .from(artworkShares)
        .where(eq(artworkShares.tokenHash, row.tokenHash));
      if (existing) {
        checkReplay(existing, row);
        return;
      }
      const active = await tx
        .select({ id: artworkShares.tokenHash })
        .from(artworkShares)
        .where(
          and(
            eq(artworkShares.userId, row.userId),
            eq(artworkShares.storyId, row.storyId),
            isNull(artworkShares.revokedAt)
          )
        );
      if (active.length >= 10)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "这个故事已有 10 个作品链接，请先停止旧链接",
        });
      await tx.insert(artworkShares).values(row);
    });
  return withLocalAggregateMutationLock(async () => {
    if (
      !memoryState.stories.some(
        story => story.id === row.storyId && story.userId === row.userId
      )
    )
      throw missing();
    const existing = memoryState.artworkShares.find(
      item => item.tokenHash === row.tokenHash
    );
    if (existing) {
      checkReplay(existing, row);
      return;
    }
    if (
      memoryState.artworkShares.filter(
        item =>
          item.storyId === row.storyId &&
          item.userId === row.userId &&
          !item.revokedAt
      ).length >= 10
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "这个故事已有 10 个作品链接，请先停止旧链接",
      });
    memoryState.artworkShares.push(row);
    try {
      await persistMemoryState();
    } catch (error) {
      memoryState.artworkShares = memoryState.artworkShares.filter(
        item => item !== row
      );
      throw error;
    }
  });
}
export async function readArtworkShare(tokenHash: string) {
  const db = await getDb();
  if (db) {
    const [row] = await db
      .select({ share: artworkShares })
      .from(artworkShares)
      .innerJoin(
        stories,
        and(
          eq(stories.id, artworkShares.storyId),
          eq(stories.userId, artworkShares.userId)
        )
      )
      .where(
        and(
          eq(artworkShares.tokenHash, tokenHash),
          isNull(artworkShares.revokedAt)
        )
      )
      .limit(1);
    if (!row) throw missing();
    return row.share.snapshot;
  }
  return withLocalAggregateMutationLock(async () => {
    const row = memoryState.artworkShares.find(
      item => item.tokenHash === tokenHash && !item.revokedAt
    );
    if (
      !row ||
      !memoryState.stories.some(
        story => story.id === row.storyId && story.userId === row.userId
      )
    )
      throw missing();
    return structuredClone(row.snapshot);
  });
}
export async function revokeArtworkShares(userId: number, storyId: number) {
  const db = await getDb();
  if (db) {
    await db
      .update(artworkShares)
      .set({ revokedAt: new Date(), snapshot: { title: "已停止", pages: [] } })
      .where(
        and(
          eq(artworkShares.storyId, storyId),
          eq(artworkShares.userId, userId),
          isNull(artworkShares.revokedAt)
        )
      );
    return;
  }
  await withLocalAggregateMutationLock(async () => {
    const before = structuredClone(memoryState.artworkShares);
    for (const row of memoryState.artworkShares)
      if (row.storyId === storyId && row.userId === userId && !row.revokedAt) {
        row.revokedAt = new Date();
        row.snapshot = { title: "已停止", pages: [] };
      }
    try {
      await persistMemoryState();
    } catch (error) {
      memoryState.artworkShares = before;
      throw error;
    }
  });
}
