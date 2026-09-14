import express from "express";
import axios from "axios";
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

import {
  createInviteCode,
  getLoginIdentity,
  getUserByOpenId,
  getUserSessionVersion,
  linkEmailIdentity,
  resetMemoryStateForTesting,
  upsertUser,
} from "../db";
import { issueEmailOtp, setAccountPassword } from "../services/accountIdentity";
import { hashInviteCode } from "../services/inviteAccess";
import { ENV } from "./env";
import { registerOAuthRoutes } from "./oauth";
import { sdk } from "./sdk";

let server: Server;
let baseUrl = "";

async function post(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function sessionCookieFrom(response: Response): string | null {
  const raw = response.headers.get("set-cookie");
  if (!raw) return null;
  const match = /app_session_id=([^;]+)/.exec(raw);
  return match ? decodeURIComponent(match[1]) : null;
}

beforeAll(async () => {
  ENV.betaInviteRequired = true;
  ENV.isProduction = false;
  ENV.resendApiKey = "";
  ENV.cookieSecret = "oauth-account-test-secret";
  ENV.otpDigestSecret = "oauth-account-otp-secret";
  ENV.otpDigestSecretVersion = 1;
  ENV.accountAutoIdentityResolution = false;
  ENV.googleInviteRequired = true;
  ENV.googleClientId = "google-client-id-for-test";
  ENV.googleClientSecret = "google-client-secret-for-test";

  const app = express();
  app.use(express.json());
  registerOAuthRoutes(app);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
});

beforeEach(() => {
  resetMemoryStateForTesting();
  ENV.supabaseAuthUrl = "";
  ENV.supabaseAuthPublishableKey = "";
  ENV.googleInviteRequired = true;
  vi.restoreAllMocks();
});

/**
 * 先锁住现有登录链路的行为，再动它。
 *
 * 这些断言描述的是「改动之前它就是这样」，不是「它应该这样」。U4 若要改动其中任何一条，
 * 必须是明写在计划里的改动，并在同一个提交里更新这里。
 */
describe("现有邀请码登录链路（characterization）", () => {
  const inviteCode = "LH-CHAR-TEST";
  const email = "characterization@example.com";

  async function seedInvite() {
    await createInviteCode({
      codeHash: hashInviteCode(inviteCode),
      label: "characterization",
      expiresAt: new Date(Date.now() + 60_000),
    });
  }

  it("邀请码登录签发 HttpOnly / Path=/ / SameSite=Lax 的会话 Cookie", async () => {
    await seedInvite();
    const response = await post("/api/auth/email/invite-login", {
      email,
      inviteCode,
    });
    const raw = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(raw).toContain("app_session_id=");
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/Path=\//i);
    expect(raw).toMatch(/SameSite=Lax/i);
    // 明文 http 下不带 Secure：Secure 由 req.protocol 决定，而不是可伪造的头
    expect(raw).not.toMatch(/Secure/i);
  });

  it("会话 Cookie 是可验证的 JWT，openId 形如 email:<邮箱>", async () => {
    await seedInvite();
    const response = await post("/api/auth/email/invite-login", {
      email,
      inviteCode,
    });
    const token = sessionCookieFrom(response);

    expect(token).not.toBeNull();
    const session = await sdk.verifySession(token);
    expect(session?.openId).toBe(`email:${email}`);
    expect(await getUserByOpenId(`email:${email}`)).toBeDefined();
  });

  it("OTP 请求与校验走通后建立会话", async () => {
    await seedInvite();
    const requested = await post("/api/auth/email/request", {
      email,
      inviteCode,
    });
    expect(requested.status).toBe(200);

    // 本地模式下 OTP 明文落在 email_otps 里（U4 会用带 secret 的摘要取代它）
    const wrong = await post("/api/auth/email/verify", {
      email,
      inviteCode,
      code: "000000",
    });
    expect(wrong.status).toBe(401);
  });

  it("直连 Google 登录也建立一次性状态", async () => {
    const response = await fetch(`${baseUrl}/api/auth/google`, {
      redirect: "manual",
    });
    const location = new URL(response.headers.get("location")!);
    expect(response.status).toBe(302);
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(response.headers.get("set-cookie")).toMatch(
      /dt_google_direct_oauth_state=.*Path=\/api\/auth\/google\/callback.*HttpOnly/i
    );
  });

  it("邮箱格式非法时不进入任何后端逻辑", async () => {
    for (const bad of ["", "not-an-email", "a@b"]) {
      const response = await post("/api/auth/email/invite-login", {
        email: bad,
        inviteCode,
      });
      expect(response.status).toBe(400);
    }
  });
});

describe("统一账号端点（U4）", () => {
  const email = "account@example.com";
  const STRONG = "correcthorsebatterystaple";
  const NEXT_STRONG = "另一句只有我自己记得住的很长的口令";

  async function codeFor(purpose: "login" | "recover" = "login") {
    const issued = await issueEmailOtp({
      email,
      purpose,
      requestIp: "127.0.0.1",
    });
    if (issued.outcome !== "issued")
      throw new Error(`签发失败：${issued.outcome}`);
    return issued.otp.code;
  }

  async function loginWithOtp() {
    const code = await codeFor();
    const response = await post("/api/auth/account/otp/verify", {
      email,
      code,
    });
    expect(response.status).toBe(200);
    return sessionCookieFrom(response)!;
  }

  it("验证码请求对已知和未知邮箱返回同一种响应", async () => {
    const known = await post("/api/auth/account/otp/request", { email });
    const unknown = await post("/api/auth/account/otp/request", {
      email: "nobody@example.com",
    });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());
  });

  it("验证码登录签发带会话版本的 30 天 Cookie", async () => {
    const code = await codeFor();
    const response = await post("/api/auth/account/otp/verify", {
      email,
      code,
    });
    const raw = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    const maxAge = Number(/Max-Age=(\d+)/i.exec(raw)?.[1] ?? 0);
    expect(maxAge).toBe(30 * 24 * 60 * 60);

    const session = await sdk.verifySession(sessionCookieFrom(response));
    expect(session?.openId).toBe(`email:${email}`);
    expect(session?.sessionVersion).toBe(1);
  });

  it("同一个验证码不能用第二次", async () => {
    const code = await codeFor();
    expect(
      (await post("/api/auth/account/otp/verify", { email, code })).status
    ).toBe(200);
    expect(
      (await post("/api/auth/account/otp/verify", { email, code })).status
    ).toBe(401);
  });

  it("验证码与密码进入同一个 userId", async () => {
    const cookie = await loginWithOtp();
    const viaOtp = await getUserByOpenId(`email:${email}`);

    expect(
      (
        await post(
          "/api/auth/account/password/set",
          { password: STRONG },
          { cookie: `app_session_id=${cookie}` }
        )
      ).status
    ).toBe(200);

    const login = await post("/api/auth/account/password/login", {
      email,
      password: STRONG,
    });
    expect(login.status).toBe(200);
    const session = await sdk.verifySession(sessionCookieFrom(login));
    expect(session?.openId).toBe(`email:${email}`);
    expect((await getUserByOpenId(`email:${email}`))?.id).toBe(viaOtp?.id);
  });

  it("验证码登录沿用已经映射的历史账号，不创建平行邮箱账号", async () => {
    await upsertUser({
      openId: "legacy:mapped-otp",
      email,
      loginMethod: "email",
    });
    const historical = await getUserByOpenId("legacy:mapped-otp");
    await linkEmailIdentity({ userId: historical!.id, email });

    const response = await post("/api/auth/account/otp/verify", {
      email,
      code: await codeFor(),
    });
    const session = await sdk.verifySession(sessionCookieFrom(response));

    expect(response.status).toBe(200);
    expect(session?.openId).toBe("legacy:mapped-otp");
    expect((await getUserByOpenId(session!.openId))?.id).toBe(historical!.id);
    expect(await getUserByOpenId(`email:${email}`)).toBeUndefined();
  });

  it("密码登录沿用已经映射的历史账号", async () => {
    await upsertUser({
      openId: "legacy:mapped-password",
      email,
      loginMethod: "email",
    });
    const historical = await getUserByOpenId("legacy:mapped-password");
    await linkEmailIdentity({ userId: historical!.id, email });
    expect(
      (await setAccountPassword({ userId: historical!.id, password: STRONG }))
        .outcome
    ).toBe("set");

    const response = await post("/api/auth/account/password/login", {
      email,
      password: STRONG,
    });
    const session = await sdk.verifySession(sessionCookieFrom(response));

    expect(response.status).toBe(200);
    expect(session?.openId).toBe("legacy:mapped-password");
    expect((await getUserByOpenId(session!.openId))?.id).toBe(historical!.id);
    expect(await getUserByOpenId(`email:${email}`)).toBeUndefined();
  });

  it("防枚举：未知邮箱、密码错误、未设置密码都是同一个 401", async () => {
    await loginWithOtp();
    const noPassword = await post("/api/auth/account/password/login", {
      email,
      password: STRONG,
    });
    const unknown = await post("/api/auth/account/password/login", {
      email: "nobody@example.com",
      password: STRONG,
    });

    expect(noPassword.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual(await noPassword.json());
  });

  it("设置密码需要登录态", async () => {
    expect(
      (await post("/api/auth/account/password/set", { password: STRONG }))
        .status
    ).toBe(401);
  });

  it("弱口令被拒绝并给出可读原因", async () => {
    const cookie = await loginWithOtp();
    const response = await post(
      "/api/auth/account/password/set",
      { password: "short" },
      { cookie: `app_session_id=${cookie}` }
    );

    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain("15");
  });

  it("改密码撤销其他设备：旧 Cookie 失效、当前设备换发新 Cookie", async () => {
    const oldCookie = await loginWithOtp();
    const auth = { cookie: `app_session_id=${oldCookie}` };
    await post("/api/auth/account/password/set", { password: STRONG }, auth);

    const changed = await post(
      "/api/auth/account/password/change",
      { currentPassword: STRONG, nextPassword: NEXT_STRONG },
      auth
    );
    expect(changed.status).toBe(200);

    const newCookie = sessionCookieFrom(changed)!;
    expect(newCookie).not.toBe(oldCookie);
    const userId = (await getUserByOpenId(`email:${email}`))!.id;
    expect(await getUserSessionVersion(userId)).toBe(2);
    expect((await sdk.verifySession(newCookie))?.sessionVersion).toBe(2);

    // 旧 Cookie 不再能访问需要登录态的端点
    expect(
      (await post("/api/auth/account/password/set", { password: STRONG }, auth))
        .status
    ).toBe(401);
    expect(
      (
        await post(
          "/api/auth/account/password/set",
          { password: STRONG },
          { cookie: `app_session_id=${newCookie}` }
        )
      ).status
    ).toBe(200);
  });

  it("找回密码撤销全部旧 session，并且不自动登录", async () => {
    const oldCookie = await loginWithOtp();
    const auth = { cookie: `app_session_id=${oldCookie}` };
    await post("/api/auth/account/password/set", { password: STRONG }, auth);

    const code = await codeFor("recover");
    const recovered = await post("/api/auth/account/password/recover", {
      email,
      code,
      password: NEXT_STRONG,
    });

    expect(recovered.status).toBe(200);
    // 响应里不携带任何可用的会话 Cookie
    const raw = recovered.headers.get("set-cookie") ?? "";
    expect(raw).not.toMatch(/app_session_id=[^;]+;/);
    expect(
      (await post("/api/auth/account/password/set", { password: STRONG }, auth))
        .status
    ).toBe(401);
    // 新密码可以正常登录
    expect(
      (
        await post("/api/auth/account/password/login", {
          email,
          password: NEXT_STRONG,
        })
      ).status
    ).toBe(200);
  });

  it("历史账号未经人工映射时返回 409 并给出联系邮箱，而不是把故事交出去", async () => {
    await upsertUser({ openId: "legacy:x", email, loginMethod: "email" });
    const code = await codeFor();
    const response = await post("/api/auth/account/otp/verify", {
      email,
      code,
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "account_needs_manual_setup",
      contactEmail: "mountionzeng@gmail.com",
    });
  });
});

describe("直连 Google 登录兼容路径", () => {
  async function begin() {
    const response = await fetch(`${baseUrl}/api/auth/google`, { redirect: "manual" });
    const location = new URL(response.headers.get("location")!);
    return {
      state: location.searchParams.get("state") ?? "",
      cookie: response.headers.get("set-cookie")?.split(";", 1)[0] ?? "",
    };
  }

  function mockGoogleUser(input: { sub: string; email: string; email_verified?: boolean }) {
    vi.spyOn(axios, "post").mockResolvedValueOnce({ data: { access_token: "google-access-token" } });
    vi.spyOn(axios, "get").mockResolvedValueOnce({
      data: { name: "Google User", email_verified: true, ...input },
    });
  }

  it("没有发起浏览器的 state 就不交换 Google code", async () => {
    const exchange = vi.spyOn(axios, "post");
    const response = await fetch(`${baseUrl}/api/auth/google/callback?code=foreign&state=foreign`, {
      redirect: "manual",
    });
    expect(response.headers.get("location")).toBe("/login?error=invalid_oauth_state");
    expect(exchange).not.toHaveBeenCalled();
  });

  it("已验证 Google 邮箱进入现有邮箱账号并绑定稳定 subject", async () => {
    const email = "direct-google@example.com";
    await upsertUser({ openId: `email:${email}`, email, loginMethod: "email" });
    const existing = await getUserByOpenId(`email:${email}`);
    await linkEmailIdentity({ userId: existing!.id, email });
    ENV.googleInviteRequired = false;
    const started = await begin();
    mockGoogleUser({ sub: "direct-subject", email });
    const response = await fetch(
      `${baseUrl}/api/auth/google/callback?code=valid&state=${started.state}`,
      { redirect: "manual", headers: { Cookie: started.cookie } }
    );
    expect(response.headers.get("location")).toBe("/");
    const session = await sdk.verifySession(sessionCookieFrom(response));
    expect(session?.openId).toBe(`email:${email}`);
    expect(await getLoginIdentity("google", "direct-subject")).toMatchObject({ userId: existing!.id });
  });

  it("拒绝 Google 没有确认的邮箱", async () => {
    ENV.googleInviteRequired = false;
    const started = await begin();
    mockGoogleUser({ sub: "unverified-subject", email: "unverified@example.com", email_verified: false });
    const response = await fetch(
      `${baseUrl}/api/auth/google/callback?code=valid&state=${started.state}`,
      { redirect: "manual", headers: { Cookie: started.cookie } }
    );
    expect(response.headers.get("location")).toBe("/login?error=google_email_not_verified");
  });
});

describe("Supabase 托管 Google 登录", () => {
  const email = "google-member@example.com";

  beforeEach(async () => {
    ENV.supabaseAuthUrl = "https://project.supabase.co";
    ENV.supabaseAuthPublishableKey = "sb_publishable_test";
    await upsertUser({
      openId: `email:${email}`,
      email,
      loginMethod: "email",
    });
    const user = await getUserByOpenId(`email:${email}`);
    await linkEmailIdentity({ userId: user!.id, email });
  });

  it("建立一次性状态后才跳转到 Supabase Google", async () => {
    const response = await fetch(`${baseUrl}/api/auth/google`, {
      redirect: "manual",
    });
    const location = new URL(response.headers.get("location")!);
    expect(response.status).toBe(302);
    expect(location.origin).toBe("https://project.supabase.co");
    expect(location.pathname).toBe("/auth/v1/authorize");
    expect(location.searchParams.get("provider")).toBe("google");
    expect(response.headers.get("set-cookie")).toMatch(
      /dt_google_oauth_state=.*Path=\/api\/auth\/supabase\/complete.*HttpOnly/i
    );
  });

  it("只把受支持的手机返回路径带过托管授权", async () => {
    const response = await fetch(
      `${baseUrl}/api/auth/google?returnTo=${encodeURIComponent("/m")}`,
      { redirect: "manual" }
    );
    const authorizeUrl = new URL(response.headers.get("location")!);
    const callbackUrl = new URL(authorizeUrl.searchParams.get("redirect_to")!);
    expect(callbackUrl.pathname).toBe("/auth/supabase/callback");
    expect(callbackUrl.searchParams.get("returnTo")).toBe("/m");

    const unsafeResponse = await fetch(
      `${baseUrl}/api/auth/google?returnTo=${encodeURIComponent("https://evil.example")}`,
      { redirect: "manual" }
    );
    const unsafeAuthorizeUrl = new URL(
      unsafeResponse.headers.get("location")!
    );
    const unsafeCallbackUrl = new URL(
      unsafeAuthorizeUrl.searchParams.get("redirect_to")!
    );
    expect(unsafeCallbackUrl.searchParams.has("returnTo")).toBe(false);
  });

  it("拒绝没有匹配状态 Cookie 的令牌", async () => {
    const response = await post("/api/auth/supabase/complete", {
      state: "forged-state",
      accessToken: "token",
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_oauth_state" });
  });

  it("拒绝没有领取邀请的新 Google 邮箱", async () => {
    vi.spyOn(axios, "get").mockResolvedValue({
      data: {
        id: "supabase-new-user",
        email: "new-google-user@example.com",
        email_confirmed_at: "2026-09-13T00:00:00Z",
        app_metadata: { providers: ["google"] },
      },
    });
    const started = await fetch(`${baseUrl}/api/auth/google`, {
      redirect: "manual",
    });
    const cookie = started.headers.get("set-cookie")!;
    const state = /dt_google_oauth_state=([^;]+)/.exec(cookie)![1];
    const response = await post(
      "/api/auth/supabase/complete",
      { state, accessToken: "supabase-access-token" },
      { Cookie: `dt_google_oauth_state=${state}` }
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invite_required" });
  });

  it("开放 Google 注册时为新邮箱建立独立账号会话", async () => {
    const newEmail = "new-google-user@example.com";
    ENV.googleInviteRequired = false;
    vi.spyOn(axios, "get").mockResolvedValue({
      data: {
        id: "supabase-new-user",
        email: newEmail,
        email_confirmed_at: "2026-09-13T00:00:00Z",
        app_metadata: { providers: ["google"] },
      },
    });
    const started = await fetch(`${baseUrl}/api/auth/google`, {
      redirect: "manual",
    });
    const cookie = started.headers.get("set-cookie")!;
    const state = /dt_google_oauth_state=([^;]+)/.exec(cookie)![1];
    const response = await post(
      "/api/auth/supabase/complete",
      { state, accessToken: "supabase-access-token" },
      { Cookie: `dt_google_oauth_state=${state}` }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const user = await getUserByOpenId(`email:${newEmail}`);
    expect(user?.email).toBe(newEmail);
    const session = await sdk.verifySession(sessionCookieFrom(response));
    expect(session?.openId).toBe(`email:${newEmail}`);
  });

  it("验证 Supabase Google 邮箱后进入原账号", async () => {
    vi.spyOn(axios, "get").mockResolvedValue({
      data: {
        id: "supabase-google-user",
        email,
        email_confirmed_at: "2026-09-13T00:00:00Z",
        app_metadata: { providers: ["google"] },
      },
    });
    const started = await fetch(`${baseUrl}/api/auth/google`, {
      redirect: "manual",
    });
    const cookie = started.headers.get("set-cookie")!;
    const state = /dt_google_oauth_state=([^;]+)/.exec(cookie)![1];
    const response = await post(
      "/api/auth/supabase/complete",
      { state, accessToken: "supabase-access-token" },
      { Cookie: `dt_google_oauth_state=${state}` }
    );
    expect(response.status).toBe(200);
    const session = await sdk.verifySession(sessionCookieFrom(response));
    expect(session?.openId).toBe(`email:${email}`);
    expect(await getLoginIdentity("google", "supabase-google-user")).toMatchObject({
      userId: (await getUserByOpenId(`email:${email}`))!.id,
    });
  });
});
