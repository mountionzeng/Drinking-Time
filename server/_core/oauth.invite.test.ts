import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as dbModule from "../db";
import {
  createInviteCode,
  findLatestActiveEmailOtp,
  findAvailableInviteCode,
  getUserByOpenId,
  hasRedeemedInviteForEmail,
  resetMemoryStateForTesting,
} from "../db";
import {
  hashInviteCode,
  unnormalizedInviteCodeDigest,
} from "../services/inviteAccess";
import { ENV } from "./env";
import { registerOAuthRoutes } from "./oauth";

let server: Server;
let baseUrl = "";

async function post(path: string, body: Record<string, string>) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("邮箱邀请码登录", () => {
  beforeAll(async () => {
    ENV.betaInviteRequired = true;
    ENV.isProduction = false;
    ENV.resendApiKey = "";
    ENV.cookieSecret = "oauth-invite-test-secret";
    ENV.googleClientId = "";
    ENV.googleClientSecret = "";

    const app = express();
    app.use(express.json());
    registerOAuthRoutes(app);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(() => {
    resetMemoryStateForTesting();
  });

  it("新邮箱没有邀请码时不发送验证码", async () => {
    const response = await post("/api/auth/email/request", {
      email: "new@example.com",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invite_required" });
  });

  it("邀请码绑定邮箱后直接建立登录态，后续仍必须提交同一邀请码", async () => {
    const email = "tester@example.com";
    const inviteCode = "LH-AB12-CD34";
    const codeHash = hashInviteCode(inviteCode);
    await createInviteCode({
      codeHash,
      label: "登录接口测试",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const loginResponse = await post("/api/auth/email/invite-login", {
      email,
      inviteCode,
    });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers.get("set-cookie")).toContain("app_session_id");
    expect(await getUserByOpenId(`email:${email}`)).toBeDefined();
    expect(await hasRedeemedInviteForEmail(email)).toBe(true);
    expect(await findAvailableInviteCode(codeHash)).toBeNull();

    const missingInviteResponse = await post("/api/auth/email/invite-login", {
      email,
    });
    expect(missingInviteResponse.status).toBe(403);
    expect(await missingInviteResponse.json()).toEqual({
      error: "invite_required",
    });

    const returningLogin = await post("/api/auth/email/invite-login", {
      email,
      inviteCode,
    });
    expect(returningLogin.status).toBe(200);
  });

  it("摘要按带横线原码逐字生成时，正确原码也进不来——测试站故障的端到端复现", async () => {
    const email = "handwritten-digest@example.com";
    const inviteCode = "LH-HAND-MADE";
    // 记录不是通过 pnpm invite:create 建的，摘要保留了横线。
    await createInviteCode({
      codeHash: unnormalizedInviteCodeDigest(inviteCode),
      label: "手工摘要",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const brokenLogin = await post("/api/auth/email/invite-login", {
      email,
      inviteCode,
    });
    expect(brokenLogin.status).toBe(403);
    expect(await brokenLogin.json()).toEqual({ error: "invalid_invite" });

    const brokenOtpRequest = await post("/api/auth/email/request", {
      email,
      inviteCode,
    });
    expect(brokenOtpRequest.status).toBe(403);
    expect(await brokenOtpRequest.json()).toEqual({ error: "invalid_invite" });

    // 唯一的差别就是摘要：换成权威摘要后，同一个原码立刻可用。
    await createInviteCode({
      codeHash: hashInviteCode(inviteCode),
      label: "权威摘要",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const repairedLogin = await post("/api/auth/email/invite-login", {
      email,
      inviteCode,
    });
    expect(repairedLogin.status).toBe(200);
  });

  it("邮箱邀请码门禁不再阻止 Google 登录", async () => {
    const response = await fetch(`${baseUrl}/api/auth/google`, {
      redirect: "manual",
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "google_auth_not_configured",
      message: "Google 登录暂不可用，请使用邮箱登录或联系管理员。",
    });
  });

  it("OTP 消费失败时不建立 session cookie", async () => {
    const email = "otp-failure@example.com";
    const inviteCode = "LH-OTP1-FAIL";
    await createInviteCode({
      codeHash: hashInviteCode(inviteCode),
      label: null,
      expiresAt: null,
    });
    const sendLog = vi.spyOn(console, "log").mockImplementation(() => {});
    await post("/api/auth/email/request", { email, inviteCode });
    const code = String(sendLog.mock.calls.at(-1)?.[0]).match(/(\d{6})$/)![1];
    sendLog.mockRestore();
    const consume = vi
      .spyOn(dbModule, "consumeEmailOtp")
      .mockRejectedValueOnce(new Error("consume failed"));

    try {
      const response = await post("/api/auth/email/verify", {
        email,
        inviteCode,
        code,
      });

      expect(response.status).toBe(500);
      expect(response.headers.get("set-cookie")).toBeNull();
    } finally {
      consume.mockRestore();
    }
  });

  async function requestCode(email: string, inviteCode: string) {
    const sendLog = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const response = await post("/api/auth/email/request", { email, inviteCode });
      const line = String(sendLog.mock.calls.at(-1)?.[0] ?? "");
      return { response, code: line.match(/(\d{6})$/)?.[1] ?? "" };
    } finally {
      sendLog.mockRestore();
    }
  }

  it("库里只存验证码摘要，验证成功后码不能再用", async () => {
    const email = "digest@example.com";
    const inviteCode = "LH-DGST-0001";
    await createInviteCode({ codeHash: hashInviteCode(inviteCode), label: null, expiresAt: null });
    const { response, code } = await requestCode(email, inviteCode);
    expect(response.status).toBe(200);
    expect(code).toMatch(/^\d{6}$/);
    const stored = await findLatestActiveEmailOtp(email);
    expect(stored?.code).not.toBe(code);
    expect(stored?.code).toMatch(/^[0-9a-f]{16}$/);

    const ok = await post("/api/auth/email/verify", { email, inviteCode, code });
    expect(ok.status).toBe(200);
    const replay = await post("/api/auth/email/verify", { email, inviteCode, code });
    expect(replay.status).toBe(401);
  });

  it("同一个码错 5 次后作废，正确码也不能再用", async () => {
    const email = "brute@example.com";
    const inviteCode = "LH-BRUT-0001";
    await createInviteCode({ codeHash: hashInviteCode(inviteCode), label: null, expiresAt: null });
    const { code } = await requestCode(email, inviteCode);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) {
      const r = await post("/api/auth/email/verify", { email, inviteCode, code: wrong });
      expect(r.status).toBe(401);
    }
    const late = await post("/api/auth/email/verify", { email, inviteCode, code });
    expect(late.status).toBe(401);
    expect(await findLatestActiveEmailOtp(email)).toBeNull();
  });

  it("同一邮箱 60 秒内重复发码被限流，新码作废旧码", async () => {
    const email = "resend@example.com";
    const inviteCode = "LH-RSND-0001";
    await createInviteCode({ codeHash: hashInviteCode(inviteCode), label: null, expiresAt: null });
    const first = await requestCode(email, inviteCode);
    expect(first.response.status).toBe(200);
    const second = await requestCode(email, inviteCode);
    expect(second.response.status).toBe(429);
    expect((await second.response.json()).error).toBe("rate_limited");
  });

  it("已经绑定的邀请不能给另一个邮箱使用", async () => {
    const inviteCode = "LH-EF56-GH78";
    const codeHash = hashInviteCode(inviteCode);
    await createInviteCode({ codeHash, label: null, expiresAt: null });
    await post("/api/auth/email/invite-login", {
      email: "first@example.com",
      inviteCode,
    });

    const response = await post("/api/auth/email/invite-login", {
      email: "second@example.com",
      inviteCode,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invalid_invite" });
  });
});
