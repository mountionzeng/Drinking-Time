import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createEmailOtp,
  createInviteCode,
  findAvailableInviteCode,
  getUserByOpenId,
  hasRedeemedInviteForEmail,
  resetMemoryStateForTesting,
} from "../db";
import { hashInviteCode } from "../services/inviteAccess";
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

  it("新邮箱用邀请码完成登录后，后续不再需要邀请码", async () => {
    const email = "tester@example.com";
    const inviteCode = "LH-AB12-CD34";
    const codeHash = hashInviteCode(inviteCode);
    await createInviteCode({
      codeHash,
      label: "登录接口测试",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const requestResponse = await post("/api/auth/email/request", {
      email,
      inviteCode,
    });
    expect(requestResponse.status).toBe(200);
    expect(await findAvailableInviteCode(codeHash)).not.toBeNull();

    await createEmailOtp(
      email,
      "123456",
      new Date(Date.now() + 60_000)
    );
    const verifyResponse = await post("/api/auth/email/verify", {
      email,
      inviteCode,
      code: "123456",
    });

    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.headers.get("set-cookie")).toContain("app_session_id");
    expect(await getUserByOpenId(`email:${email}`)).toBeDefined();
    expect(await hasRedeemedInviteForEmail(email)).toBe(true);
    expect(await findAvailableInviteCode(codeHash)).toBeNull();

    const returningResponse = await post("/api/auth/email/request", { email });
    expect(returningResponse.status).toBe(200);
  });

  it("已经绑定的邀请不能给另一个邮箱使用", async () => {
    const inviteCode = "LH-EF56-GH78";
    const codeHash = hashInviteCode(inviteCode);
    await createInviteCode({ codeHash, label: null, expiresAt: null });
    await createEmailOtp(
      "first@example.com",
      "654321",
      new Date(Date.now() + 60_000)
    );
    await post("/api/auth/email/verify", {
      email: "first@example.com",
      inviteCode,
      code: "654321",
    });

    const response = await post("/api/auth/email/request", {
      email: "second@example.com",
      inviteCode,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invalid_invite" });
  });
});
