import {
  retainMailboxVideos,
  discardMailboxVideos,
} from "../services/storyMailboxVideo";
import { randomUUID } from "node:crypto";
import { and, eq, or, desc, count } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as s from "../../drizzle/schema";
import { memoryState } from "./runtime";
import { getStoryById } from "./stories";
import {
  mailboxThreads,
  resolveMailboxContact,
  mailboxGone,
  withMailboxPair,
  requireMailboxPair,
  appendMailboxSnapshot,
  type MailboxSql,
} from "./storyMailbox";
import { captureMailboxPackage, mailboxDigest } from "./storyMailboxPackage";
import { validateMailboxReferences } from "../services/storyMailboxReferences";
import {
  retainMailboxAudio,
  discardMailboxAudio,
} from "../services/storyMailboxAudio";

const conflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "故事已更新，请重新查看发送内容",
  });
async function author(sql: MailboxSql | null, userId: number) {
  const [user] = sql
    ? await sql
        .select({ name: s.users.name })
        .from(s.users)
        .where(eq(s.users.id, userId))
    : memoryState.users.filter(u => u.id === userId);
  return user?.name?.trim().slice(0, 100) || "朋友";
}
export async function previewMailboxStory(userId: number, storyId: number) {
  if (!(await getStoryById(storyId, userId))) throw mailboxGone();
  const pkg = await captureMailboxPackage(storyId, userId);
  validateMailboxReferences(pkg);
  return {
    title: pkg.title,
    inventory: pkg.inventory,
    fingerprint: pkg.fingerprint,
  };
}
export async function sendMailboxStory(
  userId: number,
  input: {
    contactId: string;
    storyId: number;
    requestId: string;
    fingerprint: string;
    note: string;
  }
) {
  const contact = await resolveMailboxContact(userId, input.contactId);
  if (!(await getStoryById(input.storyId, userId))) throw mailboxGone();
  const staged: string[] = [],
    videoStaged: string[] = [];
  const requestHash = mailboxDigest({ userId, peer: contact.peerId, ...input });
  try {
    return await withMailboxPair(userId, contact.peerId, async sql => {
      await requireMailboxPair(sql, userId, contact.peerId);
      const [old] = sql
        ? await sql
            .select()
            .from(s.storyMailboxThreads)
            .where(eq(s.storyMailboxThreads.id, input.requestId))
        : memoryState.storyMailboxThreads.filter(t => t.id === input.requestId);
      if (old) {
        if (old.senderId !== userId || old.requestHash !== requestHash)
          throw conflict();
        return { threadId: old.id, repeated: true };
      }
      for (const owner of [userId, contact.peerId]) {
        const [threadCount] = sql
          ? await sql
              .select({ n: count() })
              .from(s.storyMailboxThreads)
              .where(
                or(
                  eq(s.storyMailboxThreads.senderId, owner),
                  eq(s.storyMailboxThreads.recipientId, owner)
                )
              )
          : [
              {
                n: memoryState.storyMailboxThreads.filter(
                  t => t.senderId === owner || t.recipientId === owner
                ).length,
              },
            ];
        if (threadCount.n >= 200)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "故事往来已达容量，现有记录保留",
          });
      }
      const pkg = await captureMailboxPackage(input.storyId, userId, sql);
      if (pkg.fingerprint !== input.fingerprint) throw conflict();
      validateMailboxReferences(pkg);
      const audioSnapshot = await retainMailboxAudio(pkg, staged);
      const snapshot = await retainMailboxVideos(
        audioSnapshot,
        input.storyId,
        videoStaged
      );
      const thread: s.StoryMailboxThread = {
        id: input.requestId,
        senderId: userId,
        recipientId: contact.peerId,
        sourceStoryId: input.storyId,
        copyStoryId: null,
        sourceFingerprint: pkg.fingerprint,
        copyFingerprint: null,
        requestHash,
        createdAt: new Date(),
      };
      if (sql) await sql.insert(s.storyMailboxThreads).values(thread);
      else memoryState.storyMailboxThreads.push(thread);
      await appendMailboxSnapshot(sql, thread, {
        senderId: userId,
        authorName: await author(sql, userId),
        storyId: input.storyId,
        note: input.note,
        package: snapshot,
      });
      return { threadId: thread.id, repeated: false };
    });
  } catch (e) {
    await discardMailboxAudio(staged);
    await discardMailboxVideos(videoStaged);
    throw e;
  }
}
/** Explicit send/accept establishes ongoing saved-work sharing for this thread. */
export async function refreshMailboxThread(userId: number, threadId: string) {
  const thread = (await mailboxThreads(userId)).find(t => t.id === threadId);
  if (!thread) throw mailboxGone();
  const peer =
      thread.senderId === userId ? thread.recipientId : thread.senderId,
    staged: string[] = [],
    videoStaged: string[] = [];
  try {
    return await withMailboxPair(userId, peer, async sql => {
      await requireMailboxPair(sql, userId, peer);
      const [current] = sql
        ? await sql
            .select()
            .from(s.storyMailboxThreads)
            .where(eq(s.storyMailboxThreads.id, threadId))
        : memoryState.storyMailboxThreads.filter(t => t.id === threadId);
      if (!current) throw mailboxGone();
      let added = 0;
      for (const [owner, storyId] of [
        [current.senderId, current.sourceStoryId],
        [current.recipientId, current.copyStoryId],
      ] as const) {
        if (!storyId) continue;
        const pkg = await captureMailboxPackage(storyId, owner, sql).catch(
          e => {
            if (e instanceof TRPCError && e.code === "NOT_FOUND") return null;
            throw e;
          }
        );
        if (!pkg) continue;
        if (
          pkg.fingerprint ===
          (owner === current.senderId
            ? current.sourceFingerprint
            : current.copyFingerprint)
        )
          continue;
        const [last] = sql
          ? await sql
              .select()
              .from(s.storyMailboxEntries)
              .where(
                and(
                  eq(s.storyMailboxEntries.threadId, threadId),
                  eq(s.storyMailboxEntries.senderId, owner)
                )
              )
              .orderBy(
                desc(s.storyMailboxEntries.createdAt),
                desc(s.storyMailboxEntries.id)
              )
              .limit(1)
          : memoryState.storyMailboxEntries
              .filter(e => e.threadId === threadId && e.senderId === owner)
              .slice(-1);
        if (last?.fingerprint === pkg.fingerprint) continue;
        validateMailboxReferences(pkg);
        const audioSnapshot = await retainMailboxAudio(
          pkg,
          staged,
          last?.snapshot
        );
        const snapshot = await retainMailboxVideos(
          audioSnapshot,
          storyId,
          videoStaged,
          last?.snapshot
        );
        await appendMailboxSnapshot(sql, current, {
          id: randomUUID(),
          senderId: owner,
          authorName: await author(sql, owner),
          storyId,
          note: "",
          package: snapshot,
        });
        const patch =
          owner === current.senderId
            ? { sourceFingerprint: pkg.fingerprint }
            : { copyFingerprint: pkg.fingerprint };
        if (sql)
          await sql
            .update(s.storyMailboxThreads)
            .set(patch)
            .where(eq(s.storyMailboxThreads.id, threadId));
        else Object.assign(current, patch);
        added++;
      }
      return { added };
    });
  } catch (e) {
    await discardMailboxAudio(staged);
    await discardMailboxVideos(videoStaged);
    throw e;
  }
}
export async function mailboxStoryChoices(userId: number) {
  // Existing story list handles trash, and only returns this account's stories.
  const { listUserStories } = await import("./stories");
  const stories = await listUserStories(userId);
  return stories.map(story => ({ id: story.id, title: story.title }));
}
