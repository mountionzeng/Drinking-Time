import { createHmac, randomBytes } from "node:crypto";
import { eq, desc, count, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { ENV } from "../_core/env";
import * as s from "../../drizzle/schema";
import {
  getDb,
  memoryState,
  persistMemoryState,
  withLocalAggregateMutationLock,
} from "./runtime";
import {
  captureMailboxPackage,
  mailboxDigest,
  type MailboxSql,
} from "./storyMailboxPackage";
import { selectMailboxPackage } from "./storyMailboxSelection";
import type { MailboxSelection } from "../../shared/storyMailboxSelection";
import {
  retainMailboxAudio,
  discardMailboxAudio,
} from "../services/storyMailboxAudio";
import {
  retainMailboxVideos,
  discardMailboxVideos,
} from "../services/storyMailboxVideo";
import { validateMailboxReferences } from "../services/storyMailboxReferences";

export const mailboxHandoffEnabled = () =>
  process.env.WECHAT_MAILBOX_ENABLED === "true";
// Optional rollout gate for new receipts; existing receipts retain their owner checks.
export function mailboxHandoffCanCreate(userId: number) {
  if (!mailboxHandoffEnabled() || !Number.isSafeInteger(userId) || userId <= 0)
    return false;
  const configured = process.env.WECHAT_MAILBOX_ALLOWED_USER_IDS;
  if (configured === undefined) return true;
  const ids = configured.split(",").map(value => value.trim());
  if (
    ids.some(
      value => !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))
    )
  )
    return false;
  return ids.includes(String(userId));
}
export function handoffMac(value: string) {
  if (ENV.cookieSecret.length < 32)
    throw new Error("mailbox_handoff_not_configured");
  return createHmac("sha256", ENV.cookieSecret)
    .update(`mailbox-handoff:v1:${value}`)
    .digest("hex");
}
const unavailable = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message: "这份来稿不可用 / Story unavailable",
  });
const conflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "内容或接收账号有变化，请重新核对 / Content or recipient changed",
  });
const shareTokenFor = (row: s.StoryMailboxHandoff) =>
  Buffer.from(
    handoffMac(`share-token:${row.id}:${row.shareHash}`),
    "hex"
  ).toString("base64url");
const codeFor = (id: string) =>
  handoffMac(`qr:${id}`).slice(0, 28).toUpperCase();
async function transaction<T>(
  userId: number,
  work: (sql: MailboxSql | null) => Promise<T>
): Promise<T> {
  const db = await getDb();
  if (db)
    return db.transaction(async tx => {
      const users = await tx
        .select({ id: s.users.id })
        .from(s.users)
        .where(eq(s.users.id, userId))
        .for("update");
      if (!users.length) throw unavailable();
      return work(tx);
    });
  return withLocalAggregateMutationLock(async () => {
    const before = structuredClone({
      storyMailboxHandoffs: memoryState.storyMailboxHandoffs,
      storyMailboxWechatBindings: memoryState.storyMailboxWechatBindings,
    });
    try {
      const result = await work(null);
      await persistMemoryState();
      return result;
    } catch (error) {
      Object.assign(memoryState, before);
      throw error;
    }
  });
}
export async function getMailboxHandoff(id: string, sql?: MailboxSql | null) {
  const db = sql === undefined ? await getDb() : sql;
  const [row] = db
    ? await db
        .select()
        .from(s.storyMailboxHandoffs)
        .where(eq(s.storyMailboxHandoffs.id, id))
    : memoryState.storyMailboxHandoffs.filter(r => r.id === id);
  return row;
}
export async function mailboxWechatBinding(
  userId: number,
  sql?: MailboxSql | null
) {
  const db = sql === undefined ? await getDb() : sql;
  const [row] = db
    ? await db
        .select()
        .from(s.storyMailboxWechatBindings)
        .where(eq(s.storyMailboxWechatBindings.userId, userId))
    : memoryState.storyMailboxWechatBindings.filter(r => r.userId === userId);
  return row;
}
export async function createMailboxHandoff(
  userId: number,
  input: {
    storyId: number;
    selection?: MailboxSelection;
    fingerprint: string;
    requestId: string;
  }
) {
  const staged: string[] = [],
    videoStaged: string[] = [];
  try {
    return await transaction(userId, async sql => {
      const requestHash = mailboxDigest({ userId, ...input });
      const old = await getMailboxHandoff(input.requestId, sql);
      if (old) {
        if (old.userId !== userId || old.requestHash !== requestHash)
          throw conflict();
        if (!old.confirmedAt && old.expiresAt.getTime() <= Date.now())
          throw conflict();
        return {
          id: old.id,
          code: codeFor(old.id),
          expiresAt: old.expiresAt,
          confirmed: Boolean(old.confirmedAt),
        };
      }
      const [total] = sql
        ? await sql
            .select({ n: count() })
            .from(s.storyMailboxHandoffs)
            .where(eq(s.storyMailboxHandoffs.userId, userId))
        : [
            {
              n: memoryState.storyMailboxHandoffs.filter(
                r => r.userId === userId
              ).length,
            },
          ];
      if (total.n >= 200)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "小程序来稿已达容量 / Mini-program inbox is full",
        });
      const pkg = selectMailboxPackage(
        await captureMailboxPackage(input.storyId, userId, sql),
        input.selection
      );
      if (pkg.fingerprint !== input.fingerprint) throw conflict();
      if (Buffer.byteLength(JSON.stringify(pkg)) > 900 * 1024)
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message:
            "本次小程序来稿过大，请选择更少内容 / Select fewer parts for this mini-program receipt",
        });
      validateMailboxReferences(pkg);
      const snapshot = await retainMailboxVideos(
        await retainMailboxAudio(pkg, staged),
        input.storyId,
        videoStaged
      );
      const now = new Date(),
        id = input.requestId,
        code = codeFor(id);
      const row: s.StoryMailboxHandoff = {
        id,
        userId,
        sourceStoryId: input.storyId,
        codeHash: handoffMac(`code:${code}`),
        requestHash,
        recipientSubject: null,
        snapshot,
        shareHash: null,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 120000),
        confirmedAt: null,
      };
      if (sql) await sql.insert(s.storyMailboxHandoffs).values(row);
      else memoryState.storyMailboxHandoffs.push(row);
      return { id, code, expiresAt: row.expiresAt, confirmed: false };
    });
  } catch (error) {
    await discardMailboxAudio(staged);
    await discardMailboxVideos(videoStaged);
    throw error;
  }
}
export async function previewMailboxHandoff(subject: string, code: string) {
  const db = await getDb(),
    codeHash = handoffMac(`code:${code}`);
  const [row] = db
    ? await db
        .select()
        .from(s.storyMailboxHandoffs)
        .where(eq(s.storyMailboxHandoffs.codeHash, codeHash))
    : memoryState.storyMailboxHandoffs.filter(r => r.codeHash === codeHash);
  if (!row || row.expiresAt.getTime() <= Date.now() || row.confirmedAt)
    throw unavailable();
  const binding = await mailboxWechatBinding(row.userId);
  if (binding && binding.subject !== subject) throw conflict();
  return row;
}
/** Trusted subject is injected only by the signed cloud bridge. No login/wallet identity is moved. */
export async function confirmMailboxHandoff(subject: string, code: string) {
  const db = await getDb(),
    codeHash = handoffMac(`code:${code}`);
  const [initial] = db
    ? await db
        .select()
        .from(s.storyMailboxHandoffs)
        .where(eq(s.storyMailboxHandoffs.codeHash, codeHash))
    : memoryState.storyMailboxHandoffs.filter(r => r.codeHash === codeHash);
  if (!initial) throw unavailable();
  return transaction(initial.userId, async sql => {
    const row = await getMailboxHandoff(initial.id, sql);
    if (!row) throw unavailable();
    if (row.confirmedAt) {
      if (row.recipientSubject !== subject) throw unavailable();
      return { id: row.id, repeated: true };
    }
    if (row.expiresAt.getTime() <= Date.now()) throw unavailable();
    const binding = await mailboxWechatBinding(row.userId, sql);
    if (binding && binding.subject !== subject) throw conflict();
    if (!binding) {
      const value = { userId: row.userId, subject, createdAt: new Date() };
      if (sql) await sql.insert(s.storyMailboxWechatBindings).values(value);
      else memoryState.storyMailboxWechatBindings.push(value);
    }
    const patch = { recipientSubject: subject, confirmedAt: new Date() };
    if (sql)
      await sql
        .update(s.storyMailboxHandoffs)
        .set(patch)
        .where(eq(s.storyMailboxHandoffs.id, row.id));
    else Object.assign(row, patch);
    return { id: row.id, repeated: false };
  });
}
export async function listNativeMailbox(subject: string) {
  const db = await getDb();
  const rows = db
    ? await db
        .select({
          id: s.storyMailboxHandoffs.id,
          title: sql<string>`JSON_UNQUOTE(JSON_EXTRACT(${s.storyMailboxHandoffs.snapshot}, '$.title'))`,
          createdAt: s.storyMailboxHandoffs.createdAt,
        })
        .from(s.storyMailboxHandoffs)
        .where(eq(s.storyMailboxHandoffs.recipientSubject, subject))
        .orderBy(desc(s.storyMailboxHandoffs.createdAt))
        .limit(200)
    : memoryState.storyMailboxHandoffs
        .filter(r => r.recipientSubject === subject)
        .slice(-200)
        .reverse()
        .map(r => ({
          id: r.id,
          title: r.snapshot.title,
          createdAt: r.createdAt,
        }));
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    createdAt: r.createdAt.toISOString(),
  }));
}
export async function readNativeMailbox(
  subject: string,
  id: string,
  token?: string
) {
  const row = await getMailboxHandoff(id);
  if (
    !row?.confirmedAt ||
    (row.recipientSubject !== subject &&
      (!token ||
        !row.shareHash ||
        handoffMac(`compare:${shareTokenFor(row)}`) !==
          handoffMac(`compare:${token}`)))
  )
    throw unavailable();
  return { row, mine: row.recipientSubject === subject };
}
export async function shareNativeMailbox(
  subject: string,
  id: string,
  revoke = false
) {
  const initial = await getMailboxHandoff(id);
  if (!initial) throw unavailable();
  return transaction(initial.userId, async sql => {
    const row = await getMailboxHandoff(id, sql);
    if (!row?.confirmedAt || row.recipientSubject !== subject)
      throw unavailable();
    // Reopening the share sheet keeps existing friend links valid. Explicit revoke
    // clears the generation; a later share gets a fresh, independently signed token.
    const patch = {
      shareHash: revoke
        ? null
        : (row.shareHash ??
          handoffMac(`generation:${randomBytes(32).toString("hex")}`)),
    };
    const token = patch.shareHash ? shareTokenFor({ ...row, ...patch }) : null;
    if (sql)
      await sql
        .update(s.storyMailboxHandoffs)
        .set(patch)
        .where(eq(s.storyMailboxHandoffs.id, id));
    else Object.assign(row, patch);
    return { token };
  });
}
