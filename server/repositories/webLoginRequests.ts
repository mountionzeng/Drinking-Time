import { and, eq, gt, inArray, isNull, lt } from "drizzle-orm";

import { webLoginRequests, type WebLoginRequest } from "../../drizzle/schema";
import { getDb } from "./runtime";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type WebLoginTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** 确认后网页最多再等这么久来取走登录，之后作废。 */
export const WEB_LOGIN_CONSUME_GRACE_MS = 60_000;

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("database_required");
  return db;
}

export type CreateWebLoginRow = {
  lookupHash: string;
  verifierHash: string;
  codeHash: string;
  secretVersion: number;
  mode: "login" | "bind";
  bindUserId: number | null;
  clientHint: string;
  expiresAt: Date;
};

/** 码摘要撞到仍有效的行时返回 false，调用方换一个码重试。 */
export async function insertWebLoginRequest(row: CreateWebLoginRow, now: Date): Promise<boolean> {
  const db = await requireDb();
  // 过期超过一小时的行顺手清掉，释放码空间。
  await db.delete(webLoginRequests).where(lt(webLoginRequests.expiresAt, new Date(now.getTime() - 3_600_000)));
  const result = await db.insert(webLoginRequests).ignore().values(row);
  return result[0].affectedRows === 1;
}

export async function findWebLoginByLookup(lookupHash: string): Promise<WebLoginRequest | null> {
  const db = await requireDb();
  const [row] = await db.select().from(webLoginRequests).where(eq(webLoginRequests.lookupHash, lookupHash)).limit(1);
  return row ?? null;
}

export async function findOpenWebLoginByCode(codeHash: string, now: Date): Promise<WebLoginRequest | null> {
  const db = await requireDb();
  const [row] = await db.select().from(webLoginRequests).where(and(
    eq(webLoginRequests.codeHash, codeHash),
    inArray(webLoginRequests.status, ["pending", "scanned"]),
    gt(webLoginRequests.expiresAt, now),
  )).limit(1);
  return row ?? null;
}

export async function markWebLoginScanned(id: number, now: Date): Promise<void> {
  const db = await requireDb();
  await db.update(webLoginRequests).set({ status: "scanned" }).where(and(
    eq(webLoginRequests.id, id), eq(webLoginRequests.status, "pending"), gt(webLoginRequests.expiresAt, now),
  ));
}

/** 条件更新：只有仍待确认且未过期的请求能被决定，且只能决定一次。 */
export async function decideWebLogin(input: {
  id: number;
  status: "confirmed" | "denied" | "merge_required";
  userId: number | null;
  now: Date;
}): Promise<boolean> {
  const db = await requireDb();
  const result = await db.update(webLoginRequests).set({
    status: input.status,
    userId: input.userId,
    confirmedAt: input.now,
  }).where(and(
    eq(webLoginRequests.id, input.id),
    inArray(webLoginRequests.status, ["pending", "scanned"]),
    gt(webLoginRequests.expiresAt, input.now),
  ));
  return result[0].affectedRows === 1;
}

type AccountDecision = { outcome: "merge_required" } | { outcome: "confirmed"; userId: number };
class ExpiredConfirmation extends Error {}

/** Claim the authorization and perform account writes on the same executor. */
export async function confirmWebLoginWithAccount(input: {
  id: number;
  now: () => Date;
  resolve: (row: WebLoginRequest, tx: WebLoginTransaction) => Promise<AccountDecision>;
}): Promise<(AccountDecision & { mode: "login" | "bind" }) | { outcome: "invalid" }> {
  const db = await requireDb();
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async tx => {
        const [row] = await tx.select().from(webLoginRequests).where(eq(webLoginRequests.id, input.id)).limit(1).for("update");
        if (!row || !["pending", "scanned"].includes(row.status) || row.expiresAt <= input.now() ||
            (row.mode === "bind" && !row.bindUserId)) return { outcome: "invalid" };
        const decision = await input.resolve(row, tx);
        const confirmedAt = input.now();
        if (row.expiresAt <= confirmedAt) throw new ExpiredConfirmation();
        const [updated] = await tx.update(webLoginRequests).set({
          status: decision.outcome,
          userId: decision.outcome === "confirmed" ? decision.userId : null,
          confirmedAt,
        }).where(eq(webLoginRequests.id, row.id));
        if (updated.affectedRows !== 1) throw new Error("web_login_decision_not_saved");
        return { ...decision, mode: row.mode };
      });
    } catch (error) {
      if (error instanceof ExpiredConfirmation) return { outcome: "invalid" };
      const failure = error as { code?: string; cause?: { code?: string } };
      const code = failure.cause?.code ?? failure.code;
      // Independent verified requests for the same WeChat identity can race.
      // Retry the whole transaction so a losing insert cannot leave an orphan.
      if (attempt !== 0 || (code !== "ER_DUP_ENTRY" && code !== "ER_LOCK_DEADLOCK")) throw error;
    }
  }
}

/** confirmed → consumed 的原子领取：同一请求只有一个调用能拿到 userId。 */
export async function consumeConfirmedWebLogin(input: {
  lookupHash: string;
  verifierHash: string;
  now: Date;
}): Promise<{ userId: number; mode: "login" | "bind" } | null> {
  const db = await requireDb();
  return db.transaction(async tx => {
    const [row] = await tx.select().from(webLoginRequests).where(and(
      eq(webLoginRequests.lookupHash, input.lookupHash),
      eq(webLoginRequests.verifierHash, input.verifierHash),
      eq(webLoginRequests.status, "confirmed"),
      isNull(webLoginRequests.consumedAt),
    )).limit(1);
    if (!row || row.userId === null || !row.confirmedAt) return null;
    if (input.now.getTime() - row.confirmedAt.getTime() > WEB_LOGIN_CONSUME_GRACE_MS) return null;
    const updated = await tx.update(webLoginRequests).set({ status: "consumed", consumedAt: input.now }).where(and(
      eq(webLoginRequests.id, row.id),
      eq(webLoginRequests.status, "confirmed"),
      isNull(webLoginRequests.consumedAt),
    ));
    if (updated[0].affectedRows !== 1) return null;
    return { userId: row.userId, mode: row.mode };
  });
}
