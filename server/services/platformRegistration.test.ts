import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import { syncMissingExternalUser } from "../_core/sdk";
import { linkEmailIdentity } from "../repositories/accounts";
import { memoryState, resetMemoryStateForTesting, transientState } from "../repositories/runtime";
import { getUserById, getUserByOpenId, upsertUser } from "../repositories/users";
import { resolveGoogleLogin } from "./accountIdentity";
import { getAccountBalance, grantCredit } from "./computeLedger";
import {
  beginPlatformRegistration,
  completePlatformRegistration,
  sendPlatformRegistrationCode,
} from "./platformRegistration";
import { PLATFORM_REGISTRATION_TTL_MS } from "../repositories/platformRegistrationStore";
import { WEB_LOGIN_GIFT_MINOR } from "./webLoginGift";

beforeEach(() => {
  resetMemoryStateForTesting();
  ENV.accountAutoIdentityResolution = false;
});
afterEach(() => vi.unstubAllEnvs());

const balance = async (id: number) => (await getAccountBalance(id)).balanceMinor;
const deliver = () => {
  let code = "";
  return {
    capture: async (_channel: "email" | "phone", _subject: string, issued: string) => {
      code = issued;
    },
    read: () => code,
  };
};

async function start(openId = "platform:new") {
  const started = await beginPlatformRegistration({ openId, name: "平台用户", loginMethod: "platform", now: 1_000 });
  if ("error" in started) throw new Error(started.error);
  return started.cookieValue;
}

describe("platform registration policy", () => {
  it("keeps an unverified platform openId at zero users and zero gifts", async () => {
    const cookie = await start();
    expect(cookie).toContain(".");
    expect(await getUserByOpenId("platform:new")).toBeUndefined();
    expect(memoryState.creditLedgerEntries).toHaveLength(0);
    expect(transientState.memoryEmailOtps).toHaveLength(0);
    expect(memoryState.phoneLoginChallenges).toHaveLength(0);
  });

  it("does not let session sync create a user or store an unverified email", async () => {
    const previous = ENV.betaInviteRequired;
    try {
      ENV.betaInviteRequired = false;
      await expect(syncMissingExternalUser({
        openId: "platform:sync",
        email: "unverified@example.com",
        loginMethod: "platform",
        lastSignedIn: new Date(),
      })).rejects.toThrow("registration_required");
      expect(await getUserByOpenId("platform:sync")).toBeUndefined();
      expect(memoryState.users).toHaveLength(0);
    } finally {
      ENV.betaInviteRequired = previous;
    }
  });

  it("grants five compute once inside the verified registration, then rejects replay", async () => {
    const cookie = await start("platform:once");
    const sent = deliver();
    expect(await sendPlatformRegistrationCode({
      cookie, channel: "email", subject: "once@example.com", requestIp: "203.0.113.10", now: 1_000, deliver: sent.capture,
    })).toEqual({ ok: true });
    const created = await completePlatformRegistration({
      cookie, channel: "email", subject: "once@example.com", code: sent.read(), requestIp: "203.0.113.10", now: 1_000,
    });
    expect(created).toMatchObject({ outcome: "created" });
    const user = (await getUserByOpenId("platform:once"))!;
    expect(await balance(user.id)).toBe(WEB_LOGIN_GIFT_MINOR);
    expect(memoryState.users).toHaveLength(1);
    const replay = await completePlatformRegistration({
      cookie, channel: "email", subject: "once@example.com", code: sent.read(), requestIp: "203.0.113.10", now: 1_500,
    });
    expect(replay).toMatchObject({ error: "missing" });
    expect(await balance(user.id)).toBe(WEB_LOGIN_GIFT_MINOR);
    expect(memoryState.creditLedgerEntries.filter(entry => entry.userId === user.id)).toHaveLength(1);
  });

  it("rejects an expired challenge and a cookie from another browser", async () => {
    const cookie = await start("platform:bound");
    const sent = deliver();
    await sendPlatformRegistrationCode({
      cookie, channel: "phone", subject: "13800000000", requestIp: "203.0.113.11", now: 1_000, deliver: sent.capture,
    });
    const expired = await completePlatformRegistration({
      cookie, channel: "phone", subject: "13800000000", code: sent.read(), requestIp: "203.0.113.11",
      now: 1_000 + PLATFORM_REGISTRATION_TTL_MS + 1,
    });
    expect(expired).toMatchObject({ error: "expired" });
    const [id, , openIdPart] = cookie.split(".");
    const otherBrowser = `${id}.${"z".repeat(43)}.${openIdPart}`;
    const crossed = await completePlatformRegistration({
      cookie: otherBrowser, channel: "phone", subject: "13800000000", code: sent.read(), requestIp: "203.0.113.11", now: 1_000,
    });
    expect(crossed).toMatchObject({ error: "missing" });
    const created = await completePlatformRegistration({
      cookie, channel: "phone", subject: "13800000000", code: sent.read(), requestIp: "203.0.113.11", now: 1_000,
    });
    expect(created).toMatchObject({ outcome: "created" });
    const user = (await getUserByOpenId("platform:bound"))!;
    expect(await balance(user.id)).toBe(WEB_LOGIN_GIFT_MINOR);
    expect(memoryState.accountIdentities.filter(item => item.provider === "phone" && item.subject === "+8613800000000")).toHaveLength(1);
    expect(user.email).toBeNull();
  });

  it("rolls back a failed gift and still grants exactly once on the same challenge", async () => {
    const cookie = await start("platform:retry");
    const sent = deliver();
    await sendPlatformRegistrationCode({
      cookie, channel: "email", subject: "retry@example.com", requestIp: "203.0.113.12", now: 1_000, deliver: sent.capture,
    });
    await expect(completePlatformRegistration({
      cookie, channel: "email", subject: "retry@example.com", code: sent.read(), requestIp: "203.0.113.12", now: 1_000,
      grant: (async () => {
        throw new Error("ledger_unavailable");
      }) as typeof grantCredit,
    })).rejects.toThrow("ledger_unavailable");
    expect(await getUserByOpenId("platform:retry")).toBeUndefined();
    const created = await completePlatformRegistration({
      cookie, channel: "email", subject: "retry@example.com", code: sent.read(), requestIp: "203.0.113.12", now: 1_000,
    });
    expect(created).toMatchObject({ outcome: "created" });
    expect(await balance((await getUserByOpenId("platform:retry"))!.id)).toBe(WEB_LOGIN_GIFT_MINOR);
  });

  it("conflicts when the verified email or phone already exists and leaves the old account untouched", async () => {
    await upsertUser({ openId: "legacy:owner", email: "owner@example.com", loginMethod: "email" });
    const owner = (await getUserByOpenId("legacy:owner"))!;
    await linkEmailIdentity({ userId: owner.id, email: "owner@example.com" });
    await grantCredit({ userId: owner.id, amountMinor: 4_000_000, idempotencyKey: "seed:owner" });
    memoryState.creditHolds.push({
      id: 1, userId: owner.id, operationId: "hold-owner", amountMinor: 250_000, status: "active",
      createdAt: new Date(1_000), updatedAt: new Date(1_000),
    });
    const signedIn = owner.lastSignedIn;
    const cookie = await start("platform:clash");
    const sent = deliver();
    await sendPlatformRegistrationCode({
      cookie, channel: "email", subject: "owner@example.com", requestIp: "203.0.113.13", now: 1_000, deliver: sent.capture,
    });
    const conflict = await completePlatformRegistration({
      cookie, channel: "email", subject: "owner@example.com", code: sent.read(), requestIp: "203.0.113.13", now: 1_000,
    });
    expect(conflict).toMatchObject({ error: "conflict" });
    expect(await getUserByOpenId("platform:clash")).toBeUndefined();
    expect(memoryState.users).toHaveLength(1);
    expect(await balance(owner.id)).toBe(4_000_000);
    expect(memoryState.creditHolds).toEqual([
      expect.objectContaining({ userId: owner.id, operationId: "hold-owner", amountMinor: 250_000, status: "active" }),
    ]);
    expect(memoryState.accountIdentities.filter(item => item.provider === "email")).toHaveLength(1);
    expect((await getUserById(owner.id))?.lastSignedIn).toEqual(signedIn);
    const replay = await completePlatformRegistration({
      cookie, channel: "email", subject: "owner@example.com", code: sent.read(), requestIp: "203.0.113.13", now: 1_500,
    });
    expect(replay).toMatchObject({ error: "missing" });

    await upsertUser({ openId: "phone:owner", loginMethod: "phone" });
    const phoneOwner = (await getUserByOpenId("phone:owner"))!;
    memoryState.accountIdentities.push({
      id: 9, userId: phoneOwner.id, provider: "phone", subject: "+8613811112222",
      verifiedAt: new Date(1_000), createdAt: new Date(1_000), updatedAt: new Date(1_000),
    });
    const phoneCookie = await start("platform:phone-clash");
    const phoneSent = deliver();
    await sendPlatformRegistrationCode({
      cookie: phoneCookie, channel: "phone", subject: "13811112222", requestIp: "203.0.113.14", now: 2_000, deliver: phoneSent.capture,
    });
    expect(await completePlatformRegistration({
      cookie: phoneCookie, channel: "phone", subject: "13811112222", code: phoneSent.read(), requestIp: "203.0.113.14", now: 2_000,
    })).toMatchObject({ error: "conflict" });
    expect(await getUserByOpenId("platform:phone-clash")).toBeUndefined();
    expect(await balance(owner.id)).toBe(4_000_000);
  });

  it("still lets a verified Google login register without this extra step", async () => {
    const google = await resolveGoogleLogin({
      subject: "google-subject-1",
      email: "google-new@example.com",
      emailVerified: true,
      name: "Google",
      requestIp: "203.0.113.15",
    });
    expect(google.outcome).toBe("authenticated");
    if (google.outcome !== "authenticated") return;
    expect(await balance(google.userId)).toBe(WEB_LOGIN_GIFT_MINOR);
    expect(transientState.platformRegistrationChallenges).toHaveLength(0);
    const again = await resolveGoogleLogin({
      subject: "google-subject-1",
      email: "google-new@example.com",
      emailVerified: true,
      requestIp: "203.0.113.15",
    });
    expect(again).toMatchObject({ outcome: "authenticated", userId: google.userId });
    expect(await balance(google.userId)).toBe(WEB_LOGIN_GIFT_MINOR);
  });
});
