import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// HTTP 层的状态由替身提供；账号/Cookie/原配对码走真实实现，数据仅在 Vitest 临时目录。
vi.mock("../services/webLogin", async importOriginal => ({
  ...await importOriginal<typeof import("../services/webLogin")>(),
  createWebLoginRequest: vi.fn(),
  pollWebLoginRequest: vi.fn(),
}));

import { getUserByOpenId, resetMemoryStateForTesting, upsertUser } from "../db";
import { issuePairingCode } from "../services/accountIdentity";
import { createWebLoginRequest, pollWebLoginRequest } from "../services/webLogin";
import { ENV } from "./env";
import { registerOAuthRoutes } from "./oauth";
import { sdk } from "./sdk";

let server: Server;
let baseUrl: string;
const create = vi.mocked(createWebLoginRequest);
const poll = vi.mocked(pollWebLoginRequest);
const created = {
  outcome: "created" as const, l: "l".repeat(43), v: "v".repeat(43), code: "ABC234",
  expiresAt: new Date("2026-10-23T10:02:00Z"), clientHint: "Mac · Chrome",
};

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  ENV.isProduction = false;
  ENV.cookieSecret = "local-wechat-http-test-secret";
  ENV.otpDigestSecret = "local-wechat-http-digest-secret";
  ENV.otpDigestSecretVersion = 1;
  const app = express();
  app.use(express.json());
  registerOAuthRoutes(app);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  resetMemoryStateForTesting();
  vi.stubEnv("WECHAT_SCAN_LOGIN_ENABLED", "true");
  create.mockReset().mockResolvedValue(created);
  poll.mockReset().mockResolvedValue({ status: "pending" });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  vi.unstubAllEnvs();
});

function post(path: string, body: Record<string, unknown> = {}) {
  return fetch(`${baseUrl}/api/auth/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
async function cookieIdentity(response: Response) {
  const raw = response.headers.get("set-cookie") ?? "";
  expect(raw).toMatch(/HttpOnly/i);
  expect(raw).toMatch(/SameSite=Lax/i);
  expect(raw).toMatch(/Path=\//i);
  const token = /app_session_id=([^;]+)/.exec(raw)?.[1];
  expect(token).toBeTruthy();
  return sdk.verifySession(decodeURIComponent(token!));
}

describe("网页六位码登录 HTTP 边界", () => {
  it("关闭时 create/poll 为 no-store 404，不访问服务或写 Cookie", async () => {
    vi.stubEnv("WECHAT_SCAN_LOGIN_ENABLED", "false");
    for (const path of ["wechat-scan/create", "wechat-scan/poll"]) {
      const response = await post(path);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "disabled" });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(create).not.toHaveBeenCalled();
    expect(poll).not.toHaveBeenCalled();
  });

  it("创建只给发起方码和凭据，忽略客户端指定 userId", async () => {
    const response = await post("wechat-scan/create", { userId: 999, bindUserId: 999 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ l: created.l, v: created.v, code: created.code,
      clientHint: created.clientHint, expiresAt: created.expiresAt.toISOString() });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ bindUserId: undefined }));
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("绑定必须先鉴权，目标账号只取当前会话", async () => {
    const authenticate = vi.spyOn(sdk, "authenticateRequest").mockRejectedValueOnce(new Error("no session"));
    expect((await post("wechat-scan/create", { mode: "bind", userId: 999 })).status).toBe(401);
    expect(create).not.toHaveBeenCalled();
    authenticate.mockResolvedValueOnce({ id: 7 } as Awaited<ReturnType<typeof sdk.authenticateRequest>>);
    expect((await post("wechat-scan/create", { mode: "bind", userId: 999 })).status).toBe(200);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ bindUserId: 7 }));
  });

  it.each(["pending", "scanned", "expired", "denied", "merge_required"] as const)("%s 不写登录 Cookie，也不返回码", async status => {
    poll.mockResolvedValueOnce({ status });
    const response = await post("wechat-scan/poll", { l: created.l, v: created.v });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(poll).toHaveBeenCalledWith(expect.objectContaining({ l: created.l, v: created.v }));
  });

  it("限流与缺配置明确返回 429/503，不建立会话", async () => {
    for (const [result, status] of [
      [{ status: "rate_limited", retryAfterMs: 1000 }, 429],
      [{ status: "not_configured" }, 503],
    ] as const) {
      poll.mockResolvedValueOnce(result);
      const response = await post("wechat-scan/poll", { l: created.l, v: created.v });
      expect(response.status).toBe(status);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("新确认和原配对码给同一 userId 发会话，重新登录不换账号；绑定不切换会话", async () => {
    await upsertUser({ openId: "wx:local-wechat-http", loginMethod: "wechat" });
    const user = (await getUserByOpenId("wx:local-wechat-http"))!;
    poll.mockResolvedValue({ status: "confirmed", userId: user.id, mode: "login" });
    const first = await cookieIdentity(await post("wechat-scan/poll", { l: created.l, v: created.v }));
    const pairing = await issuePairingCode({ userId: user.id });
    if (pairing.outcome !== "issued") throw new Error("local pairing not issued");
    const second = await cookieIdentity(await post("pair/redeem", { code: pairing.code }));
    expect(first?.openId).toBe(user.openId);
    expect(second?.openId).toBe(first?.openId);
    const replay = await post("pair/redeem", { code: pairing.code });
    expect(replay.status).toBe(401);
    expect(replay.headers.get("set-cookie")).toBeNull();
    // HTTP 请求不携带旧 Cookie，模拟退出后重新获取确认结果；不代表浏览器登出交互验收。
    const again = await cookieIdentity(await post("wechat-scan/poll", { l: "another-request", v: "another-verifier" }));
    expect(again?.openId).toBe(user.openId);
    poll.mockResolvedValueOnce({ status: "confirmed", userId: user.id, mode: "bind" });
    const bound = await post("wechat-scan/poll", { l: created.l, v: created.v });
    expect(await bound.json()).toEqual({ status: "confirmed", mode: "bind" });
    expect(bound.headers.get("set-cookie")).toBeNull();
  });
});
