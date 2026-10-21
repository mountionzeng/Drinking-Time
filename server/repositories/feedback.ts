import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { feedbackPosts, type FeedbackPost } from "../../drizzle/schema";
import { getDb, memoryState, persistMemoryState } from "./runtime";
import { appendCreditLedgerEntry } from "./computeLedger";
import {
  FEEDBACK_REWARD_MINOR,
  type feedbackInput,
} from "../../shared/feedback";
import type { z } from "zod";

async function read(id: string) {
  const db = await getDb();
  const row = db
    ? (
        await db
          .select()
          .from(feedbackPosts)
          .where(eq(feedbackPosts.id, id))
          .limit(1)
      )[0]
    : memoryState.feedbackPosts.find(row => row.id === id);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "反馈不存在" });
  return row;
}

export async function createFeedback(
  userId: number,
  input: z.infer<typeof feedbackInput>
) {
  const db = await getDb();
  if (db) {
    await db
      .insert(feedbackPosts)
      .values({ ...input, userId })
      .onDuplicateKeyUpdate({ set: { id: input.id } });
  } else {
    if (!memoryState.feedbackPosts.some(row => row.id === input.id)) {
      memoryState.feedbackPosts.push({
        ...input,
        userId,
        status: "open",
        reply: null,
        reviewedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    await persistMemoryState();
  }
  const row = await read(input.id);
  if (
    row.userId !== userId ||
    row.content !== input.content ||
    row.title !== input.title ||
    row.category !== input.category ||
    JSON.stringify(row.tags) !== JSON.stringify(input.tags) ||
    row.page !== input.page
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "提交内容已变化，请刷新后重新提交",
    });
  return { id: row.id };
}

export async function listFeedback(
  input: { category?: FeedbackPost["category"]; offset: number },
  viewerId: number
) {
  const db = await getDb();
  const rows = db
    ? await db
        .select()
        .from(feedbackPosts)
        .where(
          input.category
            ? eq(feedbackPosts.category, input.category)
            : undefined
        )
        .orderBy(desc(feedbackPosts.createdAt), desc(feedbackPosts.id))
        .limit(21)
        .offset(input.offset)
    : memoryState.feedbackPosts
        .filter(row => !input.category || row.category === input.category)
        .slice()
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            b.id.localeCompare(a.id)
        )
        .slice(input.offset, input.offset + 21);
  return {
    hasMore: rows.length > 20,
    posts: rows
      .slice(0, 20)
      .map(({ userId, reviewedBy: _reviewer, ...row }) => ({
        ...row,
        isOwn: userId === viewerId,
      })),
  };
}

/** Terminal reward claim: after claiming, only adoption can resume. A crash between
 * ledger and status updates is retried with the same globally unique reward key. */
export async function reviewFeedback(
  input: { id: string; action: "adopt" | "review" | "close"; reply: string },
  actorUserId: number
) {
  const db = await getDb();
  const status =
    input.action === "adopt"
      ? "adopting"
      : input.action === "review"
        ? "reviewing"
        : "closed";
  const editable: FeedbackPost["status"][] = ["open", "reviewing", "closed"];
  if (db) {
    await db
      .update(feedbackPosts)
      .set({ status, reply: input.reply, reviewedBy: actorUserId })
      .where(
        and(
          eq(feedbackPosts.id, input.id),
          inArray(feedbackPosts.status, editable)
        )
      );
  } else {
    const row = await read(input.id);
    if (editable.includes(row.status)) {
      Object.assign(row, {
        status,
        reply: input.reply,
        reviewedBy: actorUserId,
        updatedAt: new Date(),
      });
      await persistMemoryState();
    }
  }
  const claimed = await read(input.id);
  if (input.action !== "adopt") {
    if (claimed.status === "adopting" || claimed.status === "adopted")
      throw new TRPCError({
        code: "CONFLICT",
        message: "这条反馈已采用，奖励记录不可撤销",
      });
    return { status: claimed.status };
  }
  if (claimed.status === "adopted") return { status: claimed.status };
  if (claimed.status !== "adopting")
    throw new TRPCError({ code: "CONFLICT", message: "状态已变化，请重试" });
  await appendCreditLedgerEntry({
    userId: claimed.userId,
    entryType: "gift",
    amountMinor: FEEDBACK_REWARD_MINOR,
    idempotencyKey: `feedback-adopted:${claimed.id}`,
    actorUserId: claimed.reviewedBy,
    reason: `反馈采用奖励：${claimed.title}`,
  });
  if (db) {
    await db
      .update(feedbackPosts)
      .set({ status: "adopted" })
      .where(
        and(
          eq(feedbackPosts.id, input.id),
          eq(feedbackPosts.status, "adopting")
        )
      );
  } else {
    claimed.status = "adopted";
    claimed.updatedAt = new Date();
    await persistMemoryState();
  }
  return { status: "adopted" as const };
}
