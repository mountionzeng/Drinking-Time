import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountBalance, grantCredit } from "../services/computeLedger";
import { getUserByOpenId, resetMemoryStateForTesting, upsertUser } from "../db";
import { memoryState, transientState } from "../repositories/runtime";
import { ENV } from "./env";
import { registerOAuthRoutes } from "./oauth";
import { PLATFORM_REGISTRATION_COOKIE } from "../repositories/platformRegistrationStore";
import { sdk } from "./sdk";
import { issuePlatformOAuthState, PLATFORM_OAUTH_COOKIE, PLATFORM_OAUTH_STATE_TTL_MS } from "./platformOAuthState";
import { bindWechatAccount, resolveWechatAccount } from "../services/accountIdentity";
import { openRegisteredAccount } from "../services/webLoginGift";
import { beginPlatformRegistration } from "../services/platformRegistration";

let server: Server;
let baseUrl: string;
const previousInvite = ENV.betaInviteRequired;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  ENV.isProduction = false;
  ENV.appOrigin = "";
  ENV.appId = "synthetic-platform-app";
  vi.stubEnv("OAUTH_PORTAL_URL", "https://portal.example.test");
  ENV.cookieSecret = "platform-registration-test-secret";
  ENV.otpDigestSecret = "platform-registration-digest-secret";
  const app = express();
  app.use(express.json());
  registerOAuthRoutes(app);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => {
  vi.stubEnv("OAUTH_PORTAL_URL", "https://portal.example.test");
  resetMemoryStateForTesting();
  ENV.isProduction = false;
  ENV.betaInviteRequired = false;
  ENV.accountAutoIdentityResolution = false;
});
afterAll(async () => {
  ENV.betaInviteRequired = previousInvite;
  await new Promise<void>(resolve => server.close(() => resolve()));
  vi.unstubAllEnvs();
});

function cookieFrom(response: Response, name: string) {
  const raw = response.headers.get("set-cookie") ?? "";
  return new RegExp(`${name}=([^;]+)`).exec(raw)?.[1];
}

async function startPlatformOAuth() {
  const response = await fetch(`${baseUrl}/api/oauth/login`, { redirect: "manual" });
  expect(response.status).toBe(302);
  const upstream = new URL(response.headers.get("location")!);
  expect(upstream.pathname).toBe("/app-auth");
  expect(upstream.searchParams.get("redirectUri")).toBe(`${baseUrl}/api/oauth/callback`);
  const state = upstream.searchParams.get("state")!;
  const cookie = cookieFrom(response, PLATFORM_OAUTH_COOKIE)!;
  expect(cookie).toBeTruthy();
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  return { state, cookie };
}

function requestCallback({ state, cookie }: { state: string; cookie?: string }) {
  return fetch(`${baseUrl}/api/oauth/callback?code=auth-code&state=${encodeURIComponent(state)}&emailVerified=true&openId=forged-query`, {
    redirect: "manual", headers: cookie ? { cookie: `${PLATFORM_OAUTH_COOKIE}=${cookie}` } : undefined,
  });
}

async function callback(profile: Record<string, unknown>) {
  const start = await startPlatformOAuth();
  vi.spyOn(sdk, "exchangeCodeForToken").mockResolvedValueOnce({ accessToken: "token" } as never);
  vi.spyOn(sdk, "getUserInfo").mockResolvedValueOnce(profile as never);
  return requestCallback(start);
}

describe("platform registration http", () => {
  it("rejects a callback without a matching browser before exchanging the code", async () => {
    const exchange = vi.spyOn(sdk, "exchangeCodeForToken").mockRejectedValueOnce(new Error("unexpected SDK call"));
    try {
      const response = await fetch(`${baseUrl}/api/oauth/callback?code=mock-code&state=mock-state`, { redirect: "manual" });
      expect(response.status).toBe(401);
      expect(exchange).not.toHaveBeenCalled();
    } finally {
      exchange.mockRestore();
    }
  });

  it("rejects forged, cross-browser and expired state, and consumes real state only once across concurrent callbacks", async () => {
    const first = await startPlatformOAuth();
    const second = await startPlatformOAuth();
    const expired = issuePlatformOAuthState(
      `${baseUrl}/api/oauth/callback`, ENV.cookieSecret, Date.now() - PLATFORM_OAUTH_STATE_TTL_MS - 1,
    );
    const exchange = vi.spyOn(sdk, "exchangeCodeForToken").mockResolvedValueOnce({ accessToken: "token" } as never);
    const profile = vi.spyOn(sdk, "getUserInfo").mockResolvedValueOnce({ openId: "platform:replay" } as never);
    try {
      for (const invalid of [
        { state: "" , cookie: first.cookie },
        { state: "f".repeat(43), cookie: first.cookie },
        { state: first.state, cookie: second.cookie },
        { state: first.state, cookie: "forged." + "a".repeat(43) },
        expired,
      ]) {
        expect((await requestCallback(invalid)).status).toBe(401);
      }
      expect(exchange).not.toHaveBeenCalled();
      const results = await Promise.all([requestCallback(first), requestCallback(first)]);
      expect(results.map(item => item.status).sort()).toEqual([302, 401]);
      expect((await requestCallback(first)).status).toBe(401);
      expect(exchange).toHaveBeenCalledTimes(1);
      expect(exchange).toHaveBeenCalledWith("auth-code", `${baseUrl}/api/oauth/callback`);
      expect(profile).toHaveBeenCalledTimes(1);
      expect(await getUserByOpenId("platform:replay")).toBeUndefined();
    } finally {
      exchange.mockRestore();
      profile.mockRestore();
    }
  });

  it("does not create a user from the callback or from query parameters", async () => {
    const response = await callback({
      openId: "platform:http",
      name: "新人",
      email: "http@example.com",
      emailVerified: true,
      loginMethod: "platform",
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/auth/platform-register");
    const registration = cookieFrom(response, PLATFORM_REGISTRATION_COOKIE);
    expect(registration).toBeTruthy();
    expect(response.headers.get("set-cookie")).not.toContain("app_session_id=");
    expect(await getUserByOpenId("platform:http")).toBeUndefined();
    expect(await getUserByOpenId("forged-query")).toBeUndefined();
    const status = await fetch(`${baseUrl}/api/auth/platform-registration?openId=forged-query&emailVerified=true`, {
      headers: { cookie: `${PLATFORM_REGISTRATION_COOKIE}=${registration}` },
    });
    expect(await status.json()).toMatchObject({ status: "pending" });
    expect(await getUserByOpenId("forged-query")).toBeUndefined();
    const forged = await fetch(`${baseUrl}/api/auth/platform-registration/complete`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `${PLATFORM_REGISTRATION_COOKIE}=${registration}` },
      body: JSON.stringify({
        channel: "email",
        subject: "http@example.com",
        code: "000000",
        openId: "forged-openid",
        emailVerified: true,
        userId: 1,
      }),
    });
    expect(forged.status).toBe(400);
    expect(await getUserByOpenId("platform:http")).toBeUndefined();
    expect(await getUserByOpenId("forged-openid")).toBeUndefined();
    expect(memoryState.creditLedgerEntries).toHaveLength(0);
  });

  it("logs an existing platform account in without a gift or an email overwrite", async () => {
    await upsertUser({ openId: "platform:old", email: "kept@example.com", loginMethod: "platform", name: "旧名" });
    const existing = (await getUserByOpenId("platform:old"))!;
    await grantCredit({ userId: existing.id, amountMinor: 4_000_000, idempotencyKey: "seed:old" });
    const response = await callback({
      openId: "platform:old",
      name: "新名",
      email: "changed@example.com",
      emailVerified: true,
      loginMethod: "platform",
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(cookieFrom(response, "app_session_id")).toBeTruthy();
    expect(cookieFrom(response, PLATFORM_REGISTRATION_COOKIE)).toBeUndefined();
    const saved = (await getUserByOpenId("platform:old"))!;
    expect(saved.email).toBe("kept@example.com");
    expect((await getAccountBalance(saved.id)).balanceMinor).toBe(4_000_000);
    expect(memoryState.users).toHaveLength(1);
  });

  it("fails closed in production without storage before issuing, using or cancelling a challenge", async () => {
    const challenge = await beginPlatformRegistration({ openId: "platform:local-only" });
    if ("error" in challenge) throw new Error("fixture failed");
    ENV.isProduction = true;
    vi.stubEnv("WECHAT_SCAN_LOGIN_ENABLED", "true");

    const exchange = vi.spyOn(sdk, "exchangeCodeForToken");
    exchange.mockClear();
    const authenticate = vi.spyOn(sdk, "authenticateRequest");
    authenticate.mockClear();
    const cookie = `${PLATFORM_REGISTRATION_COOKIE}=${challenge.cookieValue}`;
    const get = (path: string) => fetch(baseUrl + path, { headers: { cookie } });
    const post = (path: string, body: object) => fetch(baseUrl + path, {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    for (const response of [
      await get("/api/oauth/callback?code=fake-code&state=fake-state"),
      await get("/api/auth/platform-registration"),
      await post("/api/auth/platform-registration/code", { channel: "email", subject: "fake@example.com" }),
      await post("/api/auth/platform-registration/complete", { channel: "phone", subject: "13800000000", code: "000000" }),
      await post("/api/auth/platform-registration/cancel", {}),
      await post("/api/auth/wechat-scan/create", { mode: "bind" }),
      await post("/api/auth/account/otp/verify", { email: "fake@example.com", code: "000000" }),
    ]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "not_configured" });
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    const grant = vi.fn();
    const subject = `shiguang:${"a".repeat(64)}`;
    await expect(openRegisteredAccount({ openId: "email:fake@example.com" }, grant))
      .rejects.toThrow("registration_storage_unavailable");
    await expect(bindWechatAccount(1, subject)).rejects.toThrow("registration_storage_unavailable");
    await expect(resolveWechatAccount(subject)).rejects.toThrow("wechat_database_unavailable");
    expect(exchange).not.toHaveBeenCalled();
    expect(authenticate).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled();
    expect(transientState.platformRegistrationChallenges).toHaveLength(1);
    expect(transientState.platformRegistrationChallenges[0]).toMatchObject({ consumedAt: null, otp: null });
    expect(memoryState.users).toHaveLength(0);
    expect(memoryState.accountIdentities).toHaveLength(0);
    expect(memoryState.creditLedgerEntries).toHaveLength(0);
    expect(memoryState.accountRateLimits).toHaveLength(0);
    vi.unstubAllEnvs();
    vi.stubEnv("DATABASE_URL", "");
  });

  it("still blocks a new platform account while invites are required", async () => {
    ENV.betaInviteRequired = true;
    const response = await callback({ openId: "platform:invited", email: "invite@example.com", loginMethod: "platform" });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invite_required" });
    expect(cookieFrom(response, PLATFORM_REGISTRATION_COOKIE)).toBeUndefined();
    expect(cookieFrom(response, "app_session_id")).toBeUndefined();
    expect(await getUserByOpenId("platform:invited")).toBeUndefined();
  });
});
