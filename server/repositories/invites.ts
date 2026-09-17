/** Persistence operations for invites. Local and MySQL behavior share this boundary. */
import { eq, and, desc, gte, isNotNull, isNull, or } from "drizzle-orm";
import {
  users,
  emailOtps,
  EmailOtp,
  inviteCodes,
  InviteCode,
  InsertInviteCode,
} from "../../drizzle/schema";
import {
  ensureMemoryLoaded,
  getDb,
  memoryState,
  nextMemoryId,
  persistMemoryState,
  transientState,
} from "./runtime";

// ── Email OTP 相关函数 ──────────────────────────────────────────────

/** 创建邮箱验证码记录 */
export async function createEmailOtp(
  email: string,
  code: string,
  expiresAt: Date
): Promise<void> {
  const db = await getDb();
  if (!db) {
    transientState.memoryEmailOtps.push({
      id: transientState.nextMemoryEmailOtpId++,
      email,
      code,
      expiresAt,
      usedAt: null,
      createdAt: new Date(),
    });
    return;
  }
  await db.insert(emailOtps).values({ email, code, expiresAt });
}

/** 查找有效（未过期、未使用）的 OTP */
export async function findValidEmailOtp(
  email: string,
  code: string
): Promise<EmailOtp | null> {
  const db = await getDb();
  if (!db) {
    const current = Date.now();
    return (
      [...transientState.memoryEmailOtps]
        .reverse()
        .find(
          otp =>
            otp.email === email &&
            otp.code === code &&
            otp.expiresAt.getTime() >= current &&
            !otp.usedAt
        ) ?? null
    );
  }
  const [otp] = await db
    .select()
    .from(emailOtps)
    .where(
      and(
        eq(emailOtps.email, email),
        eq(emailOtps.code, code),
        gte(emailOtps.expiresAt, new Date()),
        isNull(emailOtps.usedAt)
      )
    )
    .limit(1);
  return otp ?? null;
}

/** 标记 OTP 已使用 */
export async function markEmailOtpUsed(id: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    const otp = transientState.memoryEmailOtps.find(item => item.id === id);
    if (otp) otp.usedAt = new Date();
    return;
  }
  await db
    .update(emailOtps)
    .set({ usedAt: new Date() })
    .where(eq(emailOtps.id, id));
}

// ── 内测邀请码相关函数 ──────────────────────────────────────────────

export type InviteOverviewRow = {
  id: number;
  label: string | null;
  status: "pending" | "redeemed" | "expired";
  redeemedByEmail: string | null;
  redeemedByUserId: number | null;
  userName: string | null;
  userEmail: string | null;
  expiresAt: Date | null;
  redeemedAt: Date | null;
  createdAt: Date;
};

/**
 * 管理员邀请概览。只返回可展示的状态字段，不暴露不可逆的邀请码哈希。
 */
export async function getInviteOverview(
  generatedAt = new Date()
): Promise<InviteOverviewRow[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
  }

  const rows = !db
    ? memoryState.inviteCodes.map(invite => {
        const user =
          invite.redeemedByUserId == null
            ? undefined
            : memoryState.users.find(
                candidate => candidate.id === invite.redeemedByUserId
              );
        return {
          id: invite.id,
          label: invite.label,
          redeemedByEmail: invite.redeemedByEmail,
          redeemedByUserId: invite.redeemedByUserId,
          userName: user?.name ?? null,
          userEmail: user?.email ?? null,
          expiresAt: invite.expiresAt,
          redeemedAt: invite.redeemedAt,
          createdAt: invite.createdAt,
        };
      })
    : await db
        .select({
          id: inviteCodes.id,
          label: inviteCodes.label,
          redeemedByEmail: inviteCodes.redeemedByEmail,
          redeemedByUserId: inviteCodes.redeemedByUserId,
          userName: users.name,
          userEmail: users.email,
          expiresAt: inviteCodes.expiresAt,
          redeemedAt: inviteCodes.redeemedAt,
          createdAt: inviteCodes.createdAt,
        })
        .from(inviteCodes)
        .leftJoin(users, eq(inviteCodes.redeemedByUserId, users.id))
        .orderBy(desc(inviteCodes.createdAt));

  return rows
    .map(row => ({
      ...row,
      status: row.redeemedAt
        ? ("redeemed" as const)
        : row.expiresAt && row.expiresAt < generatedAt
          ? ("expired" as const)
          : ("pending" as const),
    }))
    .sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
    );
}

export async function createInviteCode(
  data: Pick<InsertInviteCode, "codeHash" | "label" | "expiresAt">
): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) {
    const row: InviteCode = {
      id: nextMemoryId("inviteCode"),
      codeHash: data.codeHash,
      label: data.label ?? null,
      redeemedByEmail: null,
      redeemedByUserId: null,
      expiresAt: data.expiresAt ?? null,
      redeemedAt: null,
      createdAt: new Date(),
    };
    memoryState.inviteCodes.push(row);
    await persistMemoryState();
    return { id: row.id };
  }

  const result = await db.insert(inviteCodes).values(data);
  return { id: result[0].insertId };
}

export async function findAvailableInviteCode(
  codeHash: string
): Promise<InviteCode | null> {
  const db = await getDb();
  const current = new Date();
  if (!db) {
    return (
      memoryState.inviteCodes.find(
        item =>
          item.codeHash === codeHash &&
          !item.redeemedAt &&
          (!item.expiresAt || item.expiresAt >= current)
      ) ?? null
    );
  }

  const [invite] = await db
    .select()
    .from(inviteCodes)
    .where(
      and(
        eq(inviteCodes.codeHash, codeHash),
        isNull(inviteCodes.redeemedAt),
        or(isNull(inviteCodes.expiresAt), gte(inviteCodes.expiresAt, current))
      )
    )
    .limit(1);
  return invite ?? null;
}

/**
 * 校验邀请码是否可以由指定邮箱使用。未核销邀请码可用于首次登录；
 * 已核销邀请码只允许继续服务它最初绑定的邮箱。
 */
export async function findInviteCodeForEmailAccess(
  codeHash: string,
  email: string
): Promise<InviteCode | null> {
  const db = await getDb();
  const current = new Date();
  if (!db) {
    const invite =
      memoryState.inviteCodes.find(item => item.codeHash === codeHash) ?? null;
    if (!invite) return null;
    if (invite.redeemedAt) {
      return invite.redeemedByEmail === email ? invite : null;
    }
    return !invite.expiresAt || invite.expiresAt >= current ? invite : null;
  }

  const [invite] = await db
    .select()
    .from(inviteCodes)
    .where(eq(inviteCodes.codeHash, codeHash))
    .limit(1);
  if (!invite) return null;
  if (invite.redeemedAt) {
    return invite.redeemedByEmail === email ? invite : null;
  }
  return !invite.expiresAt || invite.expiresAt >= current ? invite : null;
}

export async function hasRedeemedInviteForEmail(
  email: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    return memoryState.inviteCodes.some(
      item => item.redeemedByEmail === email && Boolean(item.redeemedAt)
    );
  }

  const [invite] = await db
    .select({ id: inviteCodes.id })
    .from(inviteCodes)
    .where(
      and(
        eq(inviteCodes.redeemedByEmail, email),
        isNotNull(inviteCodes.redeemedAt)
      )
    )
    .limit(1);
  return Boolean(invite);
}

/**
 * 将邀请码原子绑定到邮箱。相同邮箱重试同一邀请码视为成功，方便外部服务失败后重试。
 */
export async function redeemInviteForEmail(
  codeHash: string,
  email: string
): Promise<InviteCode | null> {
  const db = await getDb();
  const current = new Date();
  if (!db) {
    let claimed: InviteCode | null = null;
    const operation = transientState.memoryInviteClaimQueue.then(async () => {
      const invite = memoryState.inviteCodes.find(
        item => item.codeHash === codeHash
      );
      if (!invite) return;
      if (invite.redeemedAt) {
        if (invite.redeemedByEmail === email) claimed = { ...invite };
        return;
      }
      if (invite.expiresAt && invite.expiresAt < current) return;

      invite.redeemedByEmail = email;
      invite.redeemedAt = current;
      claimed = { ...invite };
      await persistMemoryState();
    });
    transientState.memoryInviteClaimQueue = operation.catch(() => {});
    await operation;
    return claimed;
  }

  const [existing] = await db
    .select()
    .from(inviteCodes)
    .where(eq(inviteCodes.codeHash, codeHash))
    .limit(1);
  if (!existing) return null;
  if (existing.redeemedAt) {
    return existing.redeemedByEmail === email ? existing : null;
  }
  if (existing.expiresAt && existing.expiresAt < current) return null;

  const result = await db
    .update(inviteCodes)
    .set({
      redeemedByEmail: email,
      redeemedAt: current,
    })
    .where(
      and(
        eq(inviteCodes.id, existing.id),
        isNull(inviteCodes.redeemedAt),
        or(isNull(inviteCodes.expiresAt), gte(inviteCodes.expiresAt, current))
      )
    );
  if (result[0].affectedRows !== 1) {
    const [claimed] = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.id, existing.id))
      .limit(1);
    return claimed?.redeemedByEmail === email ? claimed : null;
  }

  return {
    ...existing,
    redeemedByEmail: email,
    redeemedAt: current,
  };
}

export async function bindRedeemedInviteToUser(
  email: string,
  userId: number
): Promise<void> {
  const db = await getDb();
  if (!db) {
    const invite = memoryState.inviteCodes.find(
      item => item.redeemedByEmail === email && Boolean(item.redeemedAt)
    );
    if (!invite || invite.redeemedByUserId === userId) return;
    invite.redeemedByUserId = userId;
    await persistMemoryState();
    return;
  }

  await db
    .update(inviteCodes)
    .set({ redeemedByUserId: userId })
    .where(
      and(
        eq(inviteCodes.redeemedByEmail, email),
        isNotNull(inviteCodes.redeemedAt)
      )
    );
}
