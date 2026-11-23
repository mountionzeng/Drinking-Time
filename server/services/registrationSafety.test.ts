import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMemoryStateForTesting, upsertUser, getUserByOpenId, getUserById } from "../db";
import { linkEmailIdentity } from "../repositories/accounts";
import { consumePersistentRateLimit } from "../repositories/accounts";
import * as runtime from "../repositories/runtime";
import { ENV } from "../_core/env";
import { getAccountBalance, grantCredit } from "./computeLedger";
import { claimWebLoginGift, openRegisteredAccount, WEB_LOGIN_GIFT_MINOR } from "./webLoginGift";
import { resolveGoogleLogin } from "./accountIdentity";
import { memoryState } from "../repositories/runtime";
import { trustedClientIp } from "../_core/oauth";

beforeEach(() => {
  resetMemoryStateForTesting();
  ENV.accountAutoIdentityResolution = false;
});
afterEach(() => vi.unstubAllEnvs());

const balance = async (id: number) => (await getAccountBalance(id)).balanceMinor;

describe("registration safety", () => {
  it("uses the socket address and does not read a client-supplied forwarding header", () => {
    const req = {
      ip: "203.0.113.8",
      socket: { remoteAddress: "203.0.113.8" },
      headers: { "x-forwarded-for": "198.51.100.99" },
    };
    expect(trustedClientIp(req)).toBe("203.0.113.8");
    expect(JSON.stringify(trustedClientIp.toString())).not.toContain("x-forwarded-for");
  });

  it("rolls the quota back with the failed gift so the retry can still grant", async () => {
    vi.stubEnv("WEB_LOGIN_GIFT_DAILY_GLOBAL_LIMIT", "1");
    let failed = true;
    await expect(openRegisteredAccount({
      openId: "email:retry-quota@example.com",
      email: "retry-quota@example.com",
      loginMethod: "email",
      requestIp: "203.0.113.10",
    }, async () => {
      if (failed) {
        failed = false;
        throw new Error("ledger_unavailable");
      }
      return { kind: "appended" as const, balanceMinor: 0 };
    })).rejects.toThrow("ledger_unavailable");
    expect(await getUserByOpenId("email:retry-quota@example.com")).toBeUndefined();
    const opened = await openRegisteredAccount({
      openId: "email:retry-quota@example.com",
      email: "retry-quota@example.com",
      loginMethod: "email",
      requestIp: "203.0.113.10",
    });
    expect((await balance(opened.userId))).toBe(WEB_LOGIN_GIFT_MINOR);
  });

  it("writes the quota on the caller transaction instead of opening another connection", async () => {
    const nested = vi.spyOn(runtime, "getDb");
    const executor = {
      insert: () => ({ values: () => ({ onDuplicateKeyUpdate: async () => undefined }) }),
      select: () => ({ from: () => ({ where: () => ({ for: () => ({ limit: async () => [] }) }) }) }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    };
    nested.mockClear();
    const decision = await consumePersistentRateLimit({
      scope: "web-login-gift:global:day",
      subject: "executor",
      windowSeconds: 86_400,
      maxAttempts: 1,
      executor,
    } as unknown as Parameters<typeof consumePersistentRateLimit>[0]);
    expect(decision.allowed).toBe(true);
    expect(nested).not.toHaveBeenCalled();
    nested.mockRestore();
  });

  it("reuses one verified email account and does not open a second gifted user", async () => {
    await upsertUser({ openId: "legacy:owner", email: "owner@example.com", loginMethod: "email" });
    const owner = (await getUserByOpenId("legacy:owner"))!;
    await linkEmailIdentity({ userId: owner.id, email: "owner@example.com" });
    await grantCredit({ userId: owner.id, amountMinor: 1_000_000, idempotencyKey: "owner-balance", reason: "原账" });
    const opened = await openRegisteredAccount({
      openId: "email:owner@example.com",
      email: "owner@example.com",
      emailVerified: true,
      loginMethod: "email",
      requestIp: "203.0.113.20",
    } as Parameters<typeof openRegisteredAccount>[0]);
    expect(opened.userId).toBe(owner.id);
    expect(opened.created).toBe(false);
    expect(await getUserByOpenId("email:owner@example.com")).toBeUndefined();
    expect(memoryState.users).toHaveLength(1);
    expect(await balance(owner.id)).toBe(1_000_000);
    expect(await claimWebLoginGift(owner)).toEqual({ kind: "ineligible" });
  });

  it("stops on duplicate legacy emails without creating, gifting, or merging balances", async () => {
    await upsertUser({ openId: "legacy:a", email: "dup@example.com", loginMethod: "email" });
    await upsertUser({ openId: "legacy:b", email: "dup@example.com", loginMethod: "email" });
    const a = (await getUserByOpenId("legacy:a"))!;
    const b = (await getUserByOpenId("legacy:b"))!;
    await grantCredit({ userId: a.id, amountMinor: 4_000_000, idempotencyKey: "a-balance", reason: "甲" });
    await grantCredit({ userId: b.id, amountMinor: 6_000_000, idempotencyKey: "b-balance", reason: "乙" });
    const opened = await openRegisteredAccount({
      openId: "email:dup@example.com",
      email: "dup@example.com",
      emailVerified: true,
      loginMethod: "email",
      requestIp: "203.0.113.21",
    } as Parameters<typeof openRegisteredAccount>[0]);
    expect(opened.created).toBe(false);
    expect("outcome" in opened ? (opened as { outcome?: string }).outcome : "conflict").toBe("conflict");
    expect(await getUserByOpenId("email:dup@example.com")).toBeUndefined();
    expect(await balance(a.id)).toBe(4_000_000);
    expect(await balance(b.id)).toBe(6_000_000);
  });

  it("does not mint a gifted email user for one unresolved legacy mailbox", async () => {
    await upsertUser({ openId: "legacy:only", email: "only@example.com", loginMethod: "email" });
    const legacy = (await getUserByOpenId("legacy:only"))!;
    await grantCredit({ userId: legacy.id, amountMinor: 2_000_000, idempotencyKey: "legacy-only", reason: "旧账" });
    const opened = await openRegisteredAccount({
      openId: "email:only@example.com",
      email: "only@example.com",
      emailVerified: true,
      loginMethod: "email",
      requestIp: "203.0.113.22",
    } as Parameters<typeof openRegisteredAccount>[0]);
    expect(opened.created).toBe(false);
    expect(await getUserByOpenId("email:only@example.com")).toBeUndefined();
    expect(await balance(legacy.id)).toBe(2_000_000);
    expect(memoryState.users).toHaveLength(1);
  });

  it("does not attach an unverified provider email to an existing account", async () => {
    await upsertUser({ openId: "legacy:verified", email: "person@example.com", loginMethod: "email" });
    const owner = (await getUserByOpenId("legacy:verified"))!;
    await linkEmailIdentity({ userId: owner.id, email: "person@example.com" });
    const opened = await openRegisteredAccount({
      openId: "platform:new",
      email: "person@example.com",
      emailVerified: false,
      loginMethod: "platform",
      requestIp: "203.0.113.23",
    } as Parameters<typeof openRegisteredAccount>[0]);
    expect(opened.userId).not.toBe(owner.id);
    expect(opened.created).toBe(true);
    expect(await balance(owner.id)).toBe(0);
    expect(await getUserByOpenId("platform:new")).toBeTruthy();
  });

  it("refuses the gift for a disposable address on Google and platform registrations", async () => {
    const google = await openRegisteredAccount({
      openId: "email:temp-google@mailinator.com",
      email: "temp-google@mailinator.com",
      emailVerified: true,
      loginMethod: "google",
      requestIp: "203.0.113.30",
    } as Parameters<typeof openRegisteredAccount>[0]);
    const platform = await openRegisteredAccount({
      openId: "platform:temp",
      email: "temp-platform@mailinator.com",
      emailVerified: true,
      loginMethod: "platform",
      requestIp: "203.0.113.31",
    } as Parameters<typeof openRegisteredAccount>[0]);
    expect(await balance(google.userId)).toBe(0);
    expect(await balance(platform.userId)).toBe(0);
    expect(await claimWebLoginGift((await getUserById(google.userId))!)).toEqual({ kind: "ineligible" });
    expect(await claimWebLoginGift((await getUserById(platform.userId))!)).toEqual({ kind: "ineligible" });
  });

  it("applies the registration IP limit to Google as well as email", async () => {
    vi.stubEnv("WEB_LOGIN_GIFT_EMAIL_IP_DAILY_LIMIT", "1");
    const first = await openRegisteredAccount({
      openId: "email:google-a@example.com", email: "google-a@example.com", emailVerified: true,
      loginMethod: "google", requestIp: "203.0.113.40",
    } as Parameters<typeof openRegisteredAccount>[0]);
    const second = await openRegisteredAccount({
      openId: "email:google-b@example.com", email: "google-b@example.com", emailVerified: true,
      loginMethod: "google", requestIp: "203.0.113.40",
    } as Parameters<typeof openRegisteredAccount>[0]);
    expect(await balance(first.userId)).toBe(WEB_LOGIN_GIFT_MINOR);
    expect(await balance(second.userId)).toBe(0);
    expect(await claimWebLoginGift((await getUserById(second.userId))!)).toEqual({ kind: "ineligible" });
  });

  it("does not leave a gifted user when the verified email already belongs to someone else", async () => {
    await upsertUser({ openId: "legacy:holder", email: "held@example.com", loginMethod: "email" });
    const holder = (await getUserByOpenId("legacy:holder"))!;
    await linkEmailIdentity({ userId: holder.id, email: "held@example.com" });
    const google = await resolveGoogleLogin({
      subject: "google-held",
      email: "held@example.com",
      emailVerified: true,
      name: "Held",
      requestIp: "203.0.113.50",
    } as Parameters<typeof resolveGoogleLogin>[0]);
    expect(google).toMatchObject({ outcome: "authenticated", userId: holder.id });
    expect(await getUserByOpenId("email:held@example.com")).toBeUndefined();
    expect(memoryState.users).toHaveLength(1);
    expect(await balance(holder.id)).toBe(0);
    expect(memoryState.accountIdentities.filter(row => row.provider === "google")).toHaveLength(1);
  });

  it("logs a later invite-style openId back into the account created by verified registration", async () => {
    const created = await openRegisteredAccount({
      openId: "email:member@example.com",
      email: "member@example.com",
      emailVerified: true,
      loginMethod: "email",
      requestIp: "203.0.113.60",
    } as Parameters<typeof openRegisteredAccount>[0]);
    expect(await balance(created.userId)).toBe(WEB_LOGIN_GIFT_MINOR);
    const again = await openRegisteredAccount({
      openId: "invite:member",
      email: "member@example.com",
      emailVerified: true,
      loginMethod: "email",
      requestIp: "198.51.100.8",
    } as Parameters<typeof openRegisteredAccount>[0]);
    expect(again).toMatchObject({ userId: created.userId, created: false });
    expect(await getUserByOpenId("invite:member")).toBeUndefined();
    expect(memoryState.users).toHaveLength(1);
    expect(await balance(created.userId)).toBe(WEB_LOGIN_GIFT_MINOR);
  });

  it("does not create a platform session user, with or without the invite wall", async () => {
    const { syncMissingExternalUser } = await import("../_core/sdk");
    const previous = ENV.betaInviteRequired;
    try {
      ENV.betaInviteRequired = true;
      await expect(syncMissingExternalUser({
        openId: "platform:bypass",
        email: "bypass@example.com",
        loginMethod: "platform",
        lastSignedIn: new Date(),
      })).rejects.toThrow("invite_required");
      expect(await getUserByOpenId("platform:bypass")).toBeUndefined();
      ENV.betaInviteRequired = false;
      await expect(syncMissingExternalUser({
        openId: "platform:plain",
        email: "plain@example.com",
        loginMethod: "platform",
        lastSignedIn: new Date(),
      })).rejects.toThrow("registration_required");
      expect(await getUserByOpenId("platform:plain")).toBeUndefined();
      expect(memoryState.users.some(user => user.email === "plain@example.com")).toBe(false);
    } finally {
      ENV.betaInviteRequired = previous;
    }
  });
});
