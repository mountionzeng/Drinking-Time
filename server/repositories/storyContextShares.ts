import { and, count, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  stories,
  storyContextShares,
  storyContextShareImports,
  type StoryContextShare,
  type InsertStory,
  type Story,
} from "../../drizzle/schema";
import {
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
  withLocalAggregateMutationLock,
} from "./runtime";

const unavailable = () =>
  new TRPCError({ code: "NOT_FOUND", message: "这个分享已停止或不存在" });
const owns = (story: Story, share: StoryContextShare) =>
  story.id === share.storyId && story.userId === share.userId;

export async function insertStoryContextShare(
  share: StoryContextShare
): Promise<void> {
  const db = await getDb();
  if (db) {
    await db.insert(storyContextShares).values(share);
    return;
  }
  await withLocalAggregateMutationLock(async () => {
    memoryState.storyContextShares.push(share);
    try {
      await persistMemoryState();
    } catch (error) {
      memoryState.storyContextShares = memoryState.storyContextShares.filter(
        row => row !== share
      );
      throw error;
    }
  });
}

export async function readStoryContextShare(
  tokenHash: string
): Promise<StoryContextShare> {
  const db = await getDb();
  if (db) {
    const [row] = await db
      .select({ share: storyContextShares })
      .from(storyContextShares)
      .innerJoin(
        stories,
        and(
          eq(stories.id, storyContextShares.storyId),
          eq(stories.userId, storyContextShares.userId)
        )
      )
      .where(
        and(
          eq(storyContextShares.tokenHash, tokenHash),
          isNull(storyContextShares.revokedAt)
        )
      )
      .limit(1);
    if (!row) throw unavailable();
    return row.share;
  }
  return withLocalAggregateMutationLock(async () => {
    const share = memoryState.storyContextShares.find(
      row => row.tokenHash === tokenHash && !row.revokedAt
    );
    if (!share || !memoryState.stories.some(story => owns(story, share)))
      throw unavailable();
    return structuredClone(share);
  });
}

export async function countStoryContextShares(
  storyId: number,
  userId: number
): Promise<number> {
  const db = await getDb();
  if (db) {
    const [row] = await db
      .select({ total: count() })
      .from(storyContextShares)
      .where(
        and(
          eq(storyContextShares.storyId, storyId),
          eq(storyContextShares.userId, userId),
          isNull(storyContextShares.revokedAt)
        )
      );
    return row.total;
  }
  return memoryState.storyContextShares.reduce(
    (total, row) =>
      total +
      Number(
        row.storyId === storyId && row.userId === userId && !row.revokedAt
      ),
    0
  );
}

export async function revokeStoryContextShares(
  storyId: number,
  userId: number
): Promise<void> {
  const db = await getDb();
  if (db) {
    await db
      .update(storyContextShares)
      .set({ revokedAt: now() })
      .where(
        and(
          eq(storyContextShares.storyId, storyId),
          eq(storyContextShares.userId, userId),
          isNull(storyContextShares.revokedAt)
        )
      );
    return;
  }
  await withLocalAggregateMutationLock(async () => {
    const rows = memoryState.storyContextShares.filter(
      row => row.storyId === storyId && row.userId === userId && !row.revokedAt
    );
    rows.forEach(row => {
      row.revokedAt = now();
    });
    try {
      await persistMemoryState();
    } catch (error) {
      rows.forEach(row => {
        row.revokedAt = null;
      });
      throw error;
    }
  });
}

/** Verify availability again under the same lock/transaction as story + receipt creation. */
export async function importStoryContextShare(
  tokenHash: string,
  userId: number,
  makeStory: (share: StoryContextShare) => InsertStory
): Promise<number> {
  const db = await getDb();
  if (db)
    return db.transaction(async tx => {
      const [share] = await tx
        .select()
        .from(storyContextShares)
        .where(eq(storyContextShares.tokenHash, tokenHash))
        .for("update");
      if (!share || share.revokedAt) throw unavailable();
      const [source] = await tx
        .select({ id: stories.id })
        .from(stories)
        .where(
          and(eq(stories.id, share.storyId), eq(stories.userId, share.userId))
        )
        .for("update");
      if (!source) throw unavailable();
      const [receipt] = await tx
        .select()
        .from(storyContextShareImports)
        .where(
          and(
            eq(storyContextShareImports.tokenHash, tokenHash),
            eq(storyContextShareImports.userId, userId)
          )
        );
      if (receipt) return receipt.storyId;
      const input = makeStory(share);
      const [result] = await tx
        .insert(stories)
        .values({ ...input, userId, projectId: null });
      await tx
        .insert(storyContextShareImports)
        .values({ tokenHash, userId, storyId: result.insertId });
      return result.insertId;
    });
  return withLocalAggregateMutationLock(async () => {
    const share = memoryState.storyContextShares.find(
      row => row.tokenHash === tokenHash && !row.revokedAt
    );
    if (!share || !memoryState.stories.some(story => owns(story, share)))
      throw unavailable();
    const prior = memoryState.storyContextShareImports.find(
      row => row.tokenHash === tokenHash && row.userId === userId
    );
    if (prior) return prior.storyId;
    const input = makeStory(structuredClone(share));
    const row: Story = {
      id: nextMemoryId("story"),
      userId,
      projectId: null,
      title: input.title,
      logline: input.logline ?? null,
      theme: input.theme ?? null,
      arc: input.arc ?? null,
      summary: input.summary ?? null,
      body: input.body,
      createdAt: now(),
      updatedAt: now(),
    };
    const receipt = { tokenHash, userId, storyId: row.id };
    memoryState.stories.push(row);
    memoryState.storyContextShareImports.push(receipt);
    try {
      await persistMemoryState();
    } catch (error) {
      memoryState.stories = memoryState.stories.filter(item => item !== row);
      memoryState.storyContextShareImports =
        memoryState.storyContextShareImports.filter(item => item !== receipt);
      throw error;
    }
    return row.id;
  });
}
