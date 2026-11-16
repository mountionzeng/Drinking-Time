import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountBalance, grantCredit } from "../services/computeLedger";
import { getUserByOpenId, resetMemoryStateForTesting, upsertUser } from "../db";
import { memoryState } from "../repositories/runtime";
import { ENV } from "./env";
import { registerOAuthRoutes } from "./oauth";
import { PLATFORM_REGISTRATION_COOKIE } from "../repositories/platformRegistrationStore";
import { sdk } from "./sdk";

let server: Server;
let baseUrl: string;
const previousInvite = ENV.betaInviteRequired;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  ENV.isProduction = false;
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
  resetMemoryStateForTesting();
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

async function callback(profile: Record<string, unknown>) {
  vi.spyOn(sdk, "exchangeCodeForToken").mockResolvedValueOnce({ accessToken: "token" } as never);
  vi.spyOn(sdk, "getUserInfo").mockResolvedValueOnce(profile as never);
  return fetch(`${baseUrl}/api/oauth/callback?code=auth-code&state=oauth-state&emailVerified=true&openId=forged-query`, { redirect: "manual" });
}

describe("platform registration http", () => {
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

  it("still blocks a new platform account while invites are required", async () => {
    ENV.betaInviteRequired = true;
    const response = await callback({ openId: "platform:invited", email: "invite@example.com", loginMethod: "platform" });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invite_required" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await getUserByOpenId("platform:invited")).toBeUndefined();
  });
});
