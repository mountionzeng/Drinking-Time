import type { User } from "../../drizzle/schema";
import { ENV } from "../_core/env";
import {
  applyDefinedValues,
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
  withLocalAggregateMutationLock,
} from "./runtime";
import { normalizeAccountEmail } from "./accounts";

type Link = { provider: "email" | "google" | "phone"; subject: string };
export type MemoryRegistrationInput = {
  openId: string;
  email?: string | null;
  emailVerified?: boolean;
  name?: string | null;
  loginMethod?: string | null;
  role?: "user" | "admin";
  lastSignedIn?: Date;
  requestIp?: string | null;
  now?: Date;
  links?: Link[];
  /** 已验证邮箱命中旧账号时，默认认领。平台新注册设为 false：冲突且不改旧账。 */
  claimExisting?: boolean;
};
export type MemoryRegistrationResult = {
  outcome: "created" | "reused" | "conflict";
  created: boolean;
  userId: number;
  userIds?: number[];
};

type VerifiedEmailDecision =
  | { kind: "reuse"; userId: number }
  | { kind: "conflict"; userIds: number[] }
  | { kind: "absent" };

function verifiedEmailDecision(email: string | null | undefined, verified: boolean | undefined): VerifiedEmailDecision | null {
  if (!verified || !email) return null;
  const normalized = normalizeAccountEmail(email);
  if (!normalized) return { kind: "absent" };
  const identity = memoryState.accountIdentities.find(item => item.provider === "email" && item.subject === normalized);
  if (identity) return { kind: "reuse", userId: identity.userId };
  const matches = memoryState.users.filter(item => normalizeAccountEmail(item.email ?? "") === normalized);
  if (matches.length > 1) return { kind: "conflict", userIds: matches.map(item => item.id).sort((a, b) => a - b) };
  if (matches.length === 1) {
    return ENV.accountAutoIdentityResolution
      ? { kind: "reuse", userId: matches[0].id }
      : { kind: "conflict", userIds: [matches[0].id] };
  }
  return { kind: "absent" };
}

function attachLinks(userId: number, links: Link[] | undefined) {
  for (const link of links ?? []) {
    const subject = link.provider === "email" ? normalizeAccountEmail(link.subject) : link.subject.trim();
    if (!subject) continue;
    const owner = memoryState.accountIdentities.find(item => item.provider === link.provider && item.subject === subject);
    if (owner && owner.userId !== userId) return { conflictUserId: owner.userId };
    if (owner) continue;
    const current = now();
    memoryState.accountIdentities.push({
      id: nextMemoryId("accountIdentity"),
      userId,
      provider: link.provider,
      subject,
      verifiedAt: current,
      createdAt: current,
      updatedAt: current,
    });
  }
  return null;
}

export async function openRegisteredAccountInMemory(
  input: MemoryRegistrationInput,
  options: {
    declined: boolean;
    permit: () => Promise<boolean>;
    grant: (userId: number) => Promise<unknown>;
  },
): Promise<MemoryRegistrationResult> {
  return withLocalAggregateMutationLock(async () => {
    const verified = verifiedEmailDecision(input.email, input.emailVerified);
    if (input.claimExisting === false && (verified?.kind === "reuse" || verified?.kind === "conflict")) {
      return {
        outcome: "conflict",
        created: false,
        userId: 0,
        userIds: verified.kind === "reuse" ? [verified.userId] : verified.userIds,
      };
    }
    if (verified?.kind === "conflict") return { outcome: "conflict", created: false, userId: 0, userIds: verified.userIds };
    if (verified?.kind === "reuse") {
      const blocked = attachLinks(verified.userId, input.links);
      if (blocked) return { outcome: "conflict", created: false, userId: 0, userIds: [verified.userId, blocked.conflictUserId].sort((a, b) => a - b) };
      await persistMemoryState();
      return { outcome: "reused", created: false, userId: verified.userId };
    }
    const existing = memoryState.users.find(user => user.openId === input.openId);
    if (existing) {
      const patch = { ...input };
      delete patch.requestIp;
      delete patch.now;
      delete patch.emailVerified;
      delete patch.links;
      applyDefinedValues(existing as unknown as Record<string, unknown>, patch as unknown as Record<string, unknown>);
      existing.updatedAt = now();
      if (input.lastSignedIn !== undefined) existing.lastSignedIn = input.lastSignedIn;
      const blocked = attachLinks(existing.id, input.links);
      if (blocked) return { outcome: "conflict", created: false, userId: 0, userIds: [existing.id, blocked.conflictUserId].sort((a, b) => a - b) };
      await persistMemoryState();
      return { outcome: "reused", created: false, userId: existing.id };
    }
    const rateSnapshot = memoryState.accountRateLimits.map(row => ({ ...row }));
    const permitted = options.declined ? false : await options.permit();
    const current = now();
    const id = nextMemoryId("user");
    memoryState.users.push({
      id,
      openId: input.openId,
      name: input.name ?? null,
      email: input.email ?? null,
      loginMethod: input.loginMethod ?? null,
      role: (input.role ?? (input.openId === ENV.ownerOpenId ? "admin" : "user")) as User["role"],
      sessionVersion: 1,
      createdAt: current,
      updatedAt: current,
      lastSignedIn: input.lastSignedIn ?? current,
    });
    const links = [
      ...(input.emailVerified && input.email ? [{ provider: "email" as const, subject: input.email }] : []),
      ...(input.links ?? []),
    ];
    const blocked = attachLinks(id, links);
    const rollback = async () => {
      memoryState.users = memoryState.users.filter(user => user.id !== id);
      memoryState.accountIdentities = memoryState.accountIdentities.filter(item => item.userId !== id);
      memoryState.creditLedgerEntries = memoryState.creditLedgerEntries.filter(entry => entry.userId !== id);
      memoryState.creditAccounts = memoryState.creditAccounts.filter(account => account.userId !== id);
      memoryState.accountRateLimits.splice(0, memoryState.accountRateLimits.length, ...rateSnapshot.map(row => ({ ...row })));
      await persistMemoryState();
    };
    if (blocked) {
      await rollback();
      return { outcome: "conflict", created: false, userId: 0, userIds: [blocked.conflictUserId] };
    }
    if (permitted) {
      try {
        await options.grant(id);
      } catch (error) {
        await rollback();
        throw error;
      }
    }
    await persistMemoryState();
    return { outcome: "created", created: true, userId: id };
  });
}

export async function bindWechatIdentityInMemory(userId: number, subject: string) {
  return withLocalAggregateMutationLock(async () => {
    const user = memoryState.users.find(item => item.id === userId);
    if (!user) throw new Error("account_missing");
    const folded = memoryState.accountIdentities.find(item =>
      item.provider === "wechat" && item.subject.toLowerCase() === subject.toLowerCase());
    if (folded && folded.subject !== subject) throw new Error("wechat_identity_collision");
    const exact = memoryState.accountIdentities.find(item => item.provider === "wechat" && item.subject === subject);
    if (exact) return exact.userId === userId ? "bound" as const : "merge_required" as const;
    const current = now();
    memoryState.accountIdentities.push({
      id: nextMemoryId("accountIdentity"),
      userId,
      provider: "wechat",
      subject,
      verifiedAt: current,
      createdAt: current,
      updatedAt: current,
    });
    await persistMemoryState();
    return "bound" as const;
  });
}

/** 服务层走这里取数据库，避免再直接导入 server/db.ts。 */
export async function registrationDatabase() {
  return getDb();
}
