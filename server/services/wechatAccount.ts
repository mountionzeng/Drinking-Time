import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { accountIdentities, users } from '../../drizzle/schema';
import { getDb } from '../db';
import { exchangeWechatCode } from './wechatCodeExchange';

/** Creates the account and identity in one transaction; no email or gift allocation. */
export async function resolveWechatAccount(subject: string): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error('wechat_database_unavailable');
  const find = async () => {
    const [row] = await db.select({ userId: accountIdentities.userId }).from(accountIdentities)
      .where(and(eq(accountIdentities.provider, 'wechat'), eq(accountIdentities.subject, subject))).limit(1);
    return row?.userId;
  };
  const existing = await find();
  if (existing !== undefined) return existing;
  try {
    return await db.transaction(async tx => {
      const [user] = await tx.insert(users).values({
        openId: `wx:${randomUUID()}`, loginMethod: 'wechat', role: 'user',
      }).$returningId();
      await tx.insert(accountIdentities).values({ userId: user.id, provider: 'wechat', subject, verifiedAt: new Date() });
      return user.id;
    });
  } catch (error) {
    // If another login won the unique identity constraint, its account is authoritative.
    // The losing transaction rolls back its new user as well.
    const winner = await find();
    if (winner !== undefined) return winner;
    throw error;
  }
}

export async function loginWechatAccount(input: {
  code: string; appId: string; appSecret: string; fetcher?: typeof fetch;
}, resolveAccount: (subject: string) => Promise<number> = resolveWechatAccount) {
  const verified = await exchangeWechatCode(input);
  if (!verified.ok) return verified;
  try {
    const userId = await resolveAccount(verified.identity.subject);
    return { ok: true as const, userId };
  } catch {
    return { ok: false as const, reason: 'unavailable' as const };
  }
}
