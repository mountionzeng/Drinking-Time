/** Persistence operations for accounts. Local and MySQL behavior share this boundary. */
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { createKeyedSerialLock } from "../utils/keyedSerialLock";
import {
  users,
  accountIdentities,
  AccountIdentity,
  accountCredentials,
  AccountCredential,
  accountVerificationChallenges,
  devicePairingCodes,
  AccountVerificationChallenge,
  accountRateLimits,
} from "../../drizzle/schema";
import {
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
  withLocalAggregateMutationLock,
} from "./runtime";

// ══════════════════════════════════════════════════════════════════════
// 统一账号：身份解析、密码凭据、验证码挑战、共享持久化限流
//
// 「一个标准化邮箱只解析到一个 userId」是整套账号的地基。解析不出唯一答案时
// **停在冲突状态**，交给人工处理——静默 merge 会把两个人的故事并进一个账号，
// 那是不可逆的。
// ══════════════════════════════════════════════════════════════════════

const memoryRateLimitLock = createKeyedSerialLock<string>();

const memoryChallengeLock = createKeyedSerialLock<string>();

export function normalizeAccountEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type EmailIdentityResolution =
  /** account_identities 里已有登记 */
  | { kind: "resolved"; userId: number }
  /** 历史 users 表里恰好一个匹配，尚未登记 identity */
  | { kind: "legacy_single"; userId: number }
  /** 同一标准化邮箱对应多个历史用户：停下来，不猜 */
  | { kind: "conflict"; userIds: number[] }
  | { kind: "absent" };

/**
 * 把标准化邮箱解析成唯一 userId。
 *
 * 先查 identity 表（`(provider, subject)` 唯一，最多一条）；没有再回落到历史
 * `users.email`。历史表里出现多个匹配时返回 conflict——调用方必须失败关闭，
 * 等 U3 的映射清单和人工裁决，不允许自动挑一个。
 */
export async function resolveEmailIdentity(
  email: string
): Promise<EmailIdentityResolution> {
  const normalized = normalizeAccountEmail(email);
  if (!normalized) return { kind: "absent" };

  const db = await getDb();
  if (!db) {
    const identity = memoryState.accountIdentities.find(
      item => item.provider === "email" && item.subject === normalized
    );
    if (identity) return { kind: "resolved", userId: identity.userId };

    const matches = memoryState.users.filter(
      item => normalizeAccountEmail(item.email ?? "") === normalized
    );
    if (matches.length === 1)
      return { kind: "legacy_single", userId: matches[0].id };
    if (matches.length > 1) {
      return { kind: "conflict", userIds: matches.map(item => item.id).sort() };
    }
    return { kind: "absent" };
  }

  const [identity] = await db
    .select()
    .from(accountIdentities)
    .where(
      and(
        eq(accountIdentities.provider, "email"),
        eq(accountIdentities.subject, normalized)
      )
    )
    .limit(1);
  if (identity) return { kind: "resolved", userId: identity.userId };

  const matches = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`LOWER(TRIM(${users.email})) = ${normalized}`);
  if (matches.length === 1)
    return { kind: "legacy_single", userId: matches[0].id };
  if (matches.length > 1) {
    return { kind: "conflict", userIds: matches.map(item => item.id).sort() };
  }
  return { kind: "absent" };
}

export async function linkEmailIdentity(input: {
  userId: number;
  email: string;
  verifiedAt?: Date | null;
}): Promise<{ kind: "linked" } | { kind: "taken"; userId: number }> {
  const normalized = normalizeAccountEmail(input.email);
  const existing = await resolveEmailIdentity(normalized);
  if (existing.kind === "resolved") {
    return existing.userId === input.userId
      ? { kind: "linked" }
      : { kind: "taken", userId: existing.userId };
  }

  const db = await getDb();
  if (!db) {
    const current = now();
    memoryState.accountIdentities.push({
      id: nextMemoryId("accountIdentity"),
      userId: input.userId,
      provider: "email",
      subject: normalized,
      verifiedAt: input.verifiedAt ?? current,
      createdAt: current,
      updatedAt: current,
    });
    await persistMemoryState();
    return { kind: "linked" };
  }

  await db.insert(accountIdentities).values({
    userId: input.userId,
    provider: "email",
    subject: normalized,
    verifiedAt: input.verifiedAt ?? new Date(),
  });
  return { kind: "linked" };
}

export type LoginIdentityProvider = "google";

export async function getLoginIdentity(
  provider: LoginIdentityProvider,
  subject: string
): Promise<AccountIdentity | null> {
  const normalized = subject.trim();
  if (!normalized) return null;
  const db = await getDb();
  if (!db) {
    return (
      memoryState.accountIdentities.find(
        item => item.provider === provider && item.subject === normalized
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(accountIdentities)
    .where(
      and(
        eq(accountIdentities.provider, provider),
        eq(accountIdentities.subject, normalized)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function linkLoginIdentity(input: {
  userId: number;
  provider: LoginIdentityProvider;
  subject: string;
  verifiedAt?: Date | null;
}): Promise<{ kind: "linked" } | { kind: "taken"; userId: number }> {
  const subject = input.subject.trim();
  if (!subject) throw new Error("登录身份 subject 不能为空");
  const existing = await getLoginIdentity(input.provider, subject);
  if (existing) {
    return existing.userId === input.userId
      ? { kind: "linked" }
      : { kind: "taken", userId: existing.userId };
  }

  const db = await getDb();
  if (!db) {
    return withLocalAggregateMutationLock(async () => {
      const winner = memoryState.accountIdentities.find(
        item => item.provider === input.provider && item.subject === subject
      );
      if (winner) {
        return winner.userId === input.userId
          ? { kind: "linked" as const }
          : { kind: "taken" as const, userId: winner.userId };
      }
      const current = now();
      memoryState.accountIdentities.push({
        id: nextMemoryId("accountIdentity"),
        userId: input.userId,
        provider: input.provider,
        subject,
        verifiedAt: input.verifiedAt ?? current,
        createdAt: current,
        updatedAt: current,
      });
      await persistMemoryState();
      return { kind: "linked" as const };
    });
  }

  try {
    await db.insert(accountIdentities).values({
      userId: input.userId,
      provider: input.provider,
      subject,
      verifiedAt: input.verifiedAt ?? new Date(),
    });
    return { kind: "linked" };
  } catch (error) {
    const winner = await getLoginIdentity(input.provider, subject);
    if (winner) {
      return winner.userId === input.userId
        ? { kind: "linked" }
        : { kind: "taken", userId: winner.userId };
    }
    throw error;
  }
}

export async function getPasswordCredential(
  userId: number
): Promise<AccountCredential | null> {
  const db = await getDb();
  if (!db) {
    return (
      memoryState.accountCredentials.find(
        item => item.userId === userId && item.kind === "password"
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(accountCredentials)
    .where(
      and(
        eq(accountCredentials.userId, userId),
        eq(accountCredentials.kind, "password")
      )
    )
    .limit(1);
  return row ?? null;
}

export async function setPasswordCredential(input: {
  userId: number;
  secret: string;
  algorithmVersion: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) {
    const current = now();
    const existing = memoryState.accountCredentials.find(
      item => item.userId === input.userId && item.kind === "password"
    );
    if (existing) {
      existing.secret = input.secret;
      existing.algorithmVersion = input.algorithmVersion;
      existing.updatedAt = current;
    } else {
      memoryState.accountCredentials.push({
        id: nextMemoryId("accountCredential"),
        userId: input.userId,
        kind: "password",
        secret: input.secret,
        algorithmVersion: input.algorithmVersion,
        createdAt: current,
        updatedAt: current,
      });
    }
    await persistMemoryState();
    return;
  }

  await db
    .insert(accountCredentials)
    .values({
      userId: input.userId,
      kind: "password",
      secret: input.secret,
      algorithmVersion: input.algorithmVersion,
    })
    .onDuplicateKeyUpdate({
      set: { secret: input.secret, algorithmVersion: input.algorithmVersion },
    });
}

export async function getUserSessionVersion(
  userId: number
): Promise<number | null> {
  const db = await getDb();
  if (!db) {
    const user = memoryState.users.find(item => item.id === userId);
    return user ? Number(user.sessionVersion ?? 1) : null;
  }
  const [row] = await db
    .select({ sessionVersion: users.sessionVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ? Number(row.sessionVersion) : null;
}

/** 自增会话版本：改密码撤销其他设备、找回密码撤销全部旧 session 都靠它。 */
export async function bumpUserSessionVersion(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) {
    const user = memoryState.users.find(item => item.id === userId);
    if (!user) throw new Error(`用户不存在：${userId}`);
    user.sessionVersion = Number(user.sessionVersion ?? 1) + 1;
    user.updatedAt = now();
    await persistMemoryState();
    return user.sessionVersion;
  }

  await db
    .update(users)
    .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, userId));
  return (await getUserSessionVersion(userId)) ?? 1;
}

export type VerificationChallengeInput = {
  email: string;
  purpose: AccountVerificationChallenge["purpose"];
  codeHash: string;
  secretVersion: number;
  expiresAt: Date;
  maxAttempts?: number;
};

/**
 * 签发一个验证码挑战，并让同邮箱同用途的旧挑战立即失效。
 *
 * 「连续点两次发送验证码，第一封里的码必须作废」——否则攻击者可以攒一批同时有效的码。
 */
export async function issueVerificationChallenge(
  input: VerificationChallengeInput
): Promise<{ id: number }> {
  const normalized = normalizeAccountEmail(input.email);
  const key = `${normalized}:${input.purpose}`;

  const db = await getDb();
  if (!db) {
    return memoryChallengeLock.run(key, async () => {
      const current = now();
      for (const challenge of memoryState.accountVerificationChallenges) {
        if (
          challenge.normalizedEmail === normalized &&
          challenge.purpose === input.purpose &&
          !challenge.consumedAt &&
          !challenge.invalidatedAt
        ) {
          challenge.invalidatedAt = current;
        }
      }
      const id = nextMemoryId("accountVerificationChallenge");
      memoryState.accountVerificationChallenges.push({
        id,
        purpose: input.purpose,
        normalizedEmail: normalized,
        codeHash: input.codeHash,
        secretVersion: input.secretVersion,
        attemptCount: 0,
        maxAttempts: input.maxAttempts ?? 5,
        sentAt: current,
        expiresAt: input.expiresAt,
        consumedAt: null,
        invalidatedAt: null,
        createdAt: current,
      });
      await persistMemoryState();
      return { id };
    });
  }

  return db.transaction(async tx => {
    await tx
      .update(accountVerificationChallenges)
      .set({ invalidatedAt: new Date() })
      .where(
        and(
          eq(accountVerificationChallenges.normalizedEmail, normalized),
          eq(accountVerificationChallenges.purpose, input.purpose),
          isNull(accountVerificationChallenges.consumedAt),
          isNull(accountVerificationChallenges.invalidatedAt)
        )
      );
    const result = await tx.insert(accountVerificationChallenges).values({
      purpose: input.purpose,
      normalizedEmail: normalized,
      codeHash: input.codeHash,
      secretVersion: input.secretVersion,
      expiresAt: input.expiresAt,
      maxAttempts: input.maxAttempts ?? 5,
    });
    return { id: result[0].insertId };
  });
}

export type ChallengeConsumption =
  | { kind: "consumed"; challenge: AccountVerificationChallenge }
  | { kind: "no_active_challenge" }
  | { kind: "expired" }
  | { kind: "too_many_attempts" }
  | { kind: "mismatch"; attemptCount: number };

/**
 * 原子地消费一个验证码挑战。
 *
 * `verify` 是调用方传进来的纯比对函数（`accountSecurity.otpDigestMatches`），
 * 在锁内执行：比对失败要计数，比对成功要立刻标记已用，这两件事必须和读取同一个事务，
 * 否则同一个码可以被并发用两次。
 */
export async function consumeVerificationChallenge(input: {
  email: string;
  purpose: AccountVerificationChallenge["purpose"];
  verify: (challenge: AccountVerificationChallenge) => boolean;
  now?: Date;
}): Promise<ChallengeConsumption> {
  const normalized = normalizeAccountEmail(input.email);
  const key = `${normalized}:${input.purpose}`;
  const current = input.now ?? new Date();

  const evaluate = (
    challenge: AccountVerificationChallenge | undefined
  ):
    | { done: ChallengeConsumption }
    | { proceed: AccountVerificationChallenge } => {
    if (!challenge) return { done: { kind: "no_active_challenge" } };
    if (challenge.expiresAt <= current) return { done: { kind: "expired" } };
    if (challenge.attemptCount >= challenge.maxAttempts) {
      return { done: { kind: "too_many_attempts" } };
    }
    return { proceed: challenge };
  };

  const db = await getDb();
  if (!db) {
    return memoryChallengeLock.run(key, async () => {
      const challenge = memoryState.accountVerificationChallenges.find(
        item =>
          item.normalizedEmail === normalized &&
          item.purpose === input.purpose &&
          !item.consumedAt &&
          !item.invalidatedAt
      );
      const outcome = evaluate(challenge);
      if ("done" in outcome) return outcome.done;

      if (!input.verify(outcome.proceed)) {
        outcome.proceed.attemptCount += 1;
        await persistMemoryState();
        return {
          kind: "mismatch" as const,
          attemptCount: outcome.proceed.attemptCount,
        };
      }
      outcome.proceed.consumedAt = current;
      await persistMemoryState();
      return { kind: "consumed" as const, challenge: { ...outcome.proceed } };
    });
  }

  return db.transaction(async tx => {
    const [challenge] = await tx
      .select()
      .from(accountVerificationChallenges)
      .where(
        and(
          eq(accountVerificationChallenges.normalizedEmail, normalized),
          eq(accountVerificationChallenges.purpose, input.purpose),
          isNull(accountVerificationChallenges.consumedAt),
          isNull(accountVerificationChallenges.invalidatedAt)
        )
      )
      .orderBy(desc(accountVerificationChallenges.id))
      .for("update")
      .limit(1);

    const outcome = evaluate(challenge);
    if ("done" in outcome) return outcome.done;

    if (!input.verify(outcome.proceed)) {
      const attemptCount = outcome.proceed.attemptCount + 1;
      await tx
        .update(accountVerificationChallenges)
        .set({ attemptCount })
        .where(eq(accountVerificationChallenges.id, outcome.proceed.id));
      return { kind: "mismatch" as const, attemptCount };
    }

    await tx
      .update(accountVerificationChallenges)
      .set({ consumedAt: current })
      .where(eq(accountVerificationChallenges.id, outcome.proceed.id));
    return {
      kind: "consumed" as const,
      challenge: { ...outcome.proceed, consumedAt: current },
    };
  });
}

export type RateLimitDecision = {
  allowed: boolean;
  /** 本窗口内已用掉的次数（含本次） */
  attemptCount: number;
  retryAfterMs: number;
};

/**
 * 共享持久化限流。
 *
 * 必须落库：PM2 重启或多进程时，进程内内存限流形同虚设。窗口用「首次尝试时间 +
 * windowSeconds」的固定窗口，超限后拒绝并给出还要等多久。
 */
/* ── 设备配对码 ───────────────────────────────────────────────────────────
   已登录的设备签发一个短命的码，另一台设备拿它换同一个账号的会话。
   语义就是「让这台手机进入我电脑上那个账号」，所以天然不会分裂身份。
   ─────────────────────────────────────────────────────────────────────── */

export type PairingRedemption =
  | { kind: "redeemed"; userId: number }
  | { kind: "not_found" }
  | { kind: "expired" };

/**
 * 签发配对码，并作废该用户此前所有未兑换的码。
 *
 * 一人同时只留一个有效码：否则电脑上多点几次「生成」，
 * 之前那些码会一直飘在外面，每一个都是一把完整账号的钥匙。
 */
export async function issueDevicePairingCode(input: {
  userId: number;
  codeHash: string;
  secretVersion: number;
  expiresAt: Date;
}): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) {
    const current = now();
    for (const row of memoryState.devicePairingCodes) {
      if (
        row.userId === input.userId &&
        !row.consumedAt &&
        !row.invalidatedAt
      ) {
        row.invalidatedAt = current;
      }
    }
    const id = nextMemoryId("devicePairingCode");
    memoryState.devicePairingCodes.push({
      id,
      userId: input.userId,
      codeHash: input.codeHash,
      secretVersion: input.secretVersion,
      expiresAt: input.expiresAt,
      consumedAt: null,
      invalidatedAt: null,
      createdAt: current,
    });
    await persistMemoryState();
    return { id };
  }

  return db.transaction(async tx => {
    await tx
      .update(devicePairingCodes)
      .set({ invalidatedAt: new Date() })
      .where(
        and(
          eq(devicePairingCodes.userId, input.userId),
          isNull(devicePairingCodes.consumedAt),
          isNull(devicePairingCodes.invalidatedAt)
        )
      );
    const result = await tx.insert(devicePairingCodes).values({
      userId: input.userId,
      codeHash: input.codeHash,
      secretVersion: input.secretVersion,
      expiresAt: input.expiresAt,
    });
    return { id: result[0].insertId };
  });
}

/**
 * 兑换配对码：按摘要唯一索引直接命中，命中即一次性作废。
 *
 * 过期和不存在**返回不同 kind 仅供服务端记账**，端点必须把两者压成同一个响应，
 * 否则「这个码存在但过期了」本身就是一条枚举信道。
 */
export async function consumeDevicePairingCode(input: {
  codeHash: string;
  now?: Date;
}): Promise<PairingRedemption> {
  const current = input.now ?? new Date();
  const db = await getDb();

  if (!db) {
    const row = memoryState.devicePairingCodes.find(
      item =>
        item.codeHash === input.codeHash &&
        !item.consumedAt &&
        !item.invalidatedAt
    );
    if (!row) return { kind: "not_found" };
    if (row.expiresAt <= current) return { kind: "expired" };
    row.consumedAt = current;
    await persistMemoryState();
    return { kind: "redeemed", userId: row.userId };
  }

  return db.transaction(async tx => {
    const rows = await tx
      .select()
      .from(devicePairingCodes)
      .where(
        and(
          eq(devicePairingCodes.codeHash, input.codeHash),
          isNull(devicePairingCodes.consumedAt),
          isNull(devicePairingCodes.invalidatedAt)
        )
      )
      .limit(1);
    const row = rows[0];
    if (!row) return { kind: "not_found" as const };
    if (row.expiresAt <= current) return { kind: "expired" as const };
    // 带上 consumedAt IS NULL 条件，两个请求同时兑换只有一个能改到行
    const updated = await tx
      .update(devicePairingCodes)
      .set({ consumedAt: current })
      .where(
        and(
          eq(devicePairingCodes.id, row.id),
          isNull(devicePairingCodes.consumedAt)
        )
      );
    if (!updated[0].affectedRows) return { kind: "not_found" as const };
    return { kind: "redeemed" as const, userId: row.userId };
  });
}

export async function consumePersistentRateLimit(input: {
  scope: string;
  subject: string;
  windowSeconds: number;
  maxAttempts: number;
  now?: Date;
}): Promise<RateLimitDecision> {
  const current = input.now ?? new Date();
  const windowMs = input.windowSeconds * 1000;
  const key = `${input.scope}:${input.subject}`;

  const decide = (
    windowStartedAt: Date,
    attemptCount: number
  ): {
    decision: RateLimitDecision;
    nextStartedAt: Date;
    nextCount: number;
  } => {
    const windowExpired =
      current.getTime() - windowStartedAt.getTime() >= windowMs;
    const startedAt = windowExpired ? current : windowStartedAt;
    const used = windowExpired ? 0 : attemptCount;
    if (used >= input.maxAttempts) {
      return {
        decision: {
          allowed: false,
          attemptCount: used,
          retryAfterMs: Math.max(
            0,
            startedAt.getTime() + windowMs - current.getTime()
          ),
        },
        nextStartedAt: startedAt,
        nextCount: used,
      };
    }
    return {
      decision: { allowed: true, attemptCount: used + 1, retryAfterMs: 0 },
      nextStartedAt: startedAt,
      nextCount: used + 1,
    };
  };

  const db = await getDb();
  if (!db) {
    return memoryRateLimitLock.run(key, async () => {
      let row = memoryState.accountRateLimits.find(
        item => item.scope === input.scope && item.subject === input.subject
      );
      if (!row) {
        row = {
          id: nextMemoryId("accountRateLimit"),
          scope: input.scope,
          subject: input.subject,
          windowStartedAt: current,
          windowSeconds: input.windowSeconds,
          attemptCount: 0,
          blockedUntil: null,
          updatedAt: current,
        };
        memoryState.accountRateLimits.push(row);
      }
      const outcome = decide(row.windowStartedAt, row.attemptCount);
      row.windowStartedAt = outcome.nextStartedAt;
      row.attemptCount = outcome.nextCount;
      row.windowSeconds = input.windowSeconds;
      row.updatedAt = current;
      await persistMemoryState();
      return outcome.decision;
    });
  }

  return db.transaction(async tx => {
    await tx
      .insert(accountRateLimits)
      .values({
        scope: input.scope,
        subject: input.subject,
        windowSeconds: input.windowSeconds,
        windowStartedAt: current,
        attemptCount: 0,
      })
      .onDuplicateKeyUpdate({ set: { windowSeconds: input.windowSeconds } });

    const [row] = await tx
      .select()
      .from(accountRateLimits)
      .where(
        and(
          eq(accountRateLimits.scope, input.scope),
          eq(accountRateLimits.subject, input.subject)
        )
      )
      .for("update")
      .limit(1);

    const outcome = decide(
      row?.windowStartedAt ?? current,
      row?.attemptCount ?? 0
    );
    await tx
      .update(accountRateLimits)
      .set({
        windowStartedAt: outcome.nextStartedAt,
        attemptCount: outcome.nextCount,
        windowSeconds: input.windowSeconds,
      })
      .where(
        and(
          eq(accountRateLimits.scope, input.scope),
          eq(accountRateLimits.subject, input.subject)
        )
      );
    return outcome.decision;
  });
}
