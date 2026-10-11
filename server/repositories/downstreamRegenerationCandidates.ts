import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  downstreamRegenerationCandidates as table,
  stories,
} from "../../drizzle/schema";
import type { DownstreamRegenerationCandidate as Candidate } from "../../shared/downstreamRegenerationCandidate";
import {
  getDb,
  memoryState,
  persistMemoryState,
  withLocalAggregateMutationLock,
} from "./runtime";
import { ownedCreationStory, type CreationOwner } from "./textSourceLineage";

const conflict = () =>
  new TRPCError({ code: "CONFLICT", message: "候选已变化，请重新查看" });
export async function listCandidates(owner: CreationOwner) {
  await ownedCreationStory(owner);
  const db = await getDb();
  const rows = db
    ? await db
        .select()
        .from(table)
        .where(
          and(eq(table.storyId, owner.storyId), eq(table.userId, owner.userId))
        )
    : memoryState.downstreamRegenerationCandidates.filter(
        r => r.storyId === owner.storyId && r.userId === owner.userId
      );
  return structuredClone(rows.map(r => r.data));
}
export async function readCandidate(owner: CreationOwner, id: string) {
  const candidate = (await listCandidates(owner)).find(c => c.id === id);
  if (!candidate)
    throw new TRPCError({ code: "NOT_FOUND", message: "候选不存在" });
  return candidate;
}
/** Serialize insertion under the Story lock; external generation happens after the claim. */
export async function claimCandidate(
  candidate: Candidate
): Promise<{ candidate: Candidate; claimed: boolean }> {
  await ownedCreationStory(candidate);
  const choose = (rows: Candidate[]) => {
    const token = candidate.operationTokens[0];
    const byToken = rows.find(c => c.operationTokens.includes(token));
    if (
      byToken &&
      (byToken.inputFingerprint !== candidate.inputFingerprint ||
        byToken.requestHashes[token] !== candidate.requestHashes[token])
    )
      throw conflict();
    const existing =
      byToken ??
      rows.find(
        c =>
          c.inputFingerprint === candidate.inputFingerprint &&
          ["pending", "ready", "adopting"].includes(c.status)
      );
    if (existing) {
      if (
        !existing.operationTokens.includes(token) &&
        existing.operationTokens.length >= 200
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "请直接查看已有候选",
        });
      return existing;
    }
    if (rows.length >= 100)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "此故事候选已达 100 份，请在新故事中继续；历史仍保留",
      });
    return null;
  };
  const db = await getDb();
  if (db)
    return db.transaction(async tx => {
      const [story] = await tx
        .select({ id: stories.id })
        .from(stories)
        .where(
          and(
            eq(stories.id, candidate.storyId),
            eq(stories.userId, candidate.userId)
          )
        )
        .for("update");
      if (!story) throw new TRPCError({ code: "NOT_FOUND" });
      const rows = await tx
        .select()
        .from(table)
        .where(
          and(
            eq(table.storyId, candidate.storyId),
            eq(table.userId, candidate.userId)
          )
        )
        .for("update");
      const existing = choose(rows.map(r => r.data));
      if (existing) {
        if (!existing.operationTokens.includes(candidate.operationTokens[0])) {
          existing.operationTokens.push(candidate.operationTokens[0]);
          existing.revision++;
          existing.requestHashes[candidate.operationTokens[0]] =
            candidate.requestHashes[candidate.operationTokens[0]];
          await tx
            .update(table)
            .set({ revision: existing.revision, data: existing })
            .where(eq(table.id, existing.id));
        }
        return { candidate: existing, claimed: false };
      }
      await tx
        .insert(table)
        .values({
          id: candidate.id,
          storyId: candidate.storyId,
          userId: candidate.userId,
          revision: candidate.revision,
          data: candidate,
        });
      return { candidate, claimed: true };
    });
  return withLocalAggregateMutationLock(async () => {
    if (
      !memoryState.stories.some(
        s => s.id === candidate.storyId && s.userId === candidate.userId
      )
    )
      throw new TRPCError({ code: "NOT_FOUND" });
    const rows = memoryState.downstreamRegenerationCandidates;
    const existing = choose(
      rows
        .filter(
          r => r.storyId === candidate.storyId && r.userId === candidate.userId
        )
        .map(r => structuredClone(r.data))
    );
    const value = existing ?? candidate;
    if (
      existing &&
      existing.operationTokens.includes(candidate.operationTokens[0])
    )
      return { candidate: existing, claimed: false };
    if (existing) {
      value.operationTokens.push(candidate.operationTokens[0]);
      value.requestHashes[candidate.operationTokens[0]] =
        candidate.requestHashes[candidate.operationTokens[0]];
      value.revision++;
    }
    const next = {
      id: value.id,
      storyId: value.storyId,
      userId: value.userId,
      revision: value.revision,
      data: value,
    };
    memoryState.downstreamRegenerationCandidates = [
      ...rows.filter(r => r.id !== value.id),
      next,
    ];
    try {
      await persistMemoryState();
    } catch (e) {
      memoryState.downstreamRegenerationCandidates = rows;
      throw e;
    }
    return { candidate: structuredClone(value), claimed: !existing };
  });
}
export async function replaceCandidate(
  owner: CreationOwner,
  next: Candidate,
  expectedRevision: number
) {
  await ownedCreationStory(owner);
  if (next.userId !== owner.userId || next.storyId !== owner.storyId)
    throw new TRPCError({ code: "NOT_FOUND" });
  const value = {
    ...next,
    revision: expectedRevision + 1,
    updatedAt: Date.now(),
  };
  if (Buffer.byteLength(JSON.stringify(value)) > 4_000_000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "候选过大，请缩小故事范围",
    });
  const db = await getDb();
  if (db) {
    const [result] = await db
      .update(table)
      .set({ revision: value.revision, data: value })
      .where(
        and(
          eq(table.id, value.id),
          eq(table.storyId, owner.storyId),
          eq(table.userId, owner.userId),
          eq(table.revision, expectedRevision)
        )
      );
    if (!result.affectedRows) throw conflict();
    return value;
  }
  return withLocalAggregateMutationLock(async () => {
    if (
      !memoryState.stories.some(
        s => s.id === owner.storyId && s.userId === owner.userId
      )
    )
      throw new TRPCError({ code: "NOT_FOUND" });
    const rows = memoryState.downstreamRegenerationCandidates;
    const old = rows.find(
      r =>
        r.id === next.id &&
        r.storyId === owner.storyId &&
        r.userId === owner.userId
    );
    if (!old || old.revision !== expectedRevision) throw conflict();
    memoryState.downstreamRegenerationCandidates = rows.map(r =>
      r === old ? { ...r, revision: value.revision, data: value } : r
    );
    try {
      await persistMemoryState();
    } catch (e) {
      memoryState.downstreamRegenerationCandidates = rows;
      throw e;
    }
    return structuredClone(value);
  });
}
