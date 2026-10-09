import express from "express";
import axios from "axios";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { registerOAuthRoutes } from "./oauth";
import { createRequestOriginMiddleware } from "./requestOrigin";
import {
  resetMemoryStateForTesting,
  memoryState,
} from "../repositories/runtime";
import { ENV } from "./env";
import { sdk } from "./sdk";

let server: Server, baseUrl: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "8kb" }));
  app.use(
    createRequestOriginMiddleware({
      isProduction: true,
      appOrigin: "https://www.drinkingtime.top",
    })
  );
  registerOAuthRoutes(app);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  if (server?.listening)
    await new Promise<void>(resolve => server.close(() => resolve()));
});
beforeEach(() => {
  resetMemoryStateForTesting();
  ENV.cookieSecret = "phone-route-test-session-secret";
  for (const [key, value] of Object.entries({
    PHONE_LOGIN_ENABLED: "true",
    TENCENT_SMS_SECRET_ID: "test-id",
    TENCENT_SMS_SECRET_KEY: "test-key",
    TENCENT_SMS_APP_ID: "1400000000",
    TENCENT_SMS_SIGN_NAME: "拾光",
    TENCENT_SMS_TEMPLATE_ID: "123456",
    PHONE_OTP_DIGEST_SECRET: "phone-route-test-otp-secret-at-least-32-chars",
  }))
    vi.stubEnv(key, value);
  vi.spyOn(axios, "post").mockImplementation(async (_url, payload) => ({
    data: {
      Response: {
        SendStatusSet: [
          {
            Code: "Ok",
            PhoneNumber: JSON.parse(String(payload)).PhoneNumberSet[0],
          },
        ],
      },
    },
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
function post(
  path: string,
  body: unknown,
  origin = "https://www.drinkingtime.top"
) {
  return fetch(`${baseUrl}/api/auth/phone/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

describe("phone login HTTP boundary", () => {
  it("rejects cross-origin requests before sending or consuming any code", async () => {
    const response = await post(
      "request",
      { phone: "13800000000" },
      "https://evil.example"
    );
    expect(response.status).toBe(403);
    expect(axios.post).not.toHaveBeenCalled();
  });
  it("exposes only availability and gives no cookie or fake success when unconfigured", async () => {
    vi.stubEnv("PHONE_LOGIN_ENABLED", "false");
    expect(
      await fetch(`${baseUrl}/api/auth/phone/config`).then(r => r.json())
    ).toEqual({ configured: false });
    const response = await post("request", { phone: "13800000000" });
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({ error: "sms_not_configured" });
  });
  it("signs a versioned 30-day session only after valid one-time proof", async () => {
    const sent = await post("request", { phone: "13800000000" });
    expect(sent.status).toBe(200);
    expect(sent.headers.get("set-cookie")).toBeNull();
    expect(await sent.json()).toEqual({ ok: true, retryAfterMs: 60000 });
    const code = JSON.parse(String(vi.mocked(axios.post).mock.calls[0][1]))
      .TemplateParamSet[0];
    const verified = await post("verify", { phone: "+8613800000000", code });
    expect(verified.status).toBe(200);
    const cookie = verified.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Max-Age=2592000");
    const token = decodeURIComponent(/app_session_id=([^;]+)/.exec(cookie)![1]);
    expect(await sdk.verifySession(token)).toMatchObject({
      openId: memoryState.users[0].openId,
      sessionVersion: 1,
    });
    const replay = await post("verify", { phone: "13800000000", code });
    expect(replay.status).toBe(401);
    expect(replay.headers.get("set-cookie")).toBeNull();
  });
  it("bounds input, returns retry timing, and catches provider errors without secrets", async () => {
    expect((await post("request", { phone: { bad: true } })).status).toBe(400);
    vi.mocked(axios.post).mockRejectedValue(
      new Error("private-provider-secret")
    );
    const failed = await post("request", { phone: "13800000000" });
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain("private-provider-secret");
    const throttled = await post("request", { phone: "13800000000" });
    expect(throttled.status).toBe(429);
    expect(Number(throttled.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(throttled.headers.get("set-cookie")).toBeNull();
  });
});
