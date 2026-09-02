import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import axios from "axios";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { ENV } from "./env";
import { hashInviteCode } from "../services/inviteAccess";
import {
  authenticateWithPassword,
  changeAccountPassword,
  completePasswordRecovery,
  issueEmailOtp,
  setAccountPassword,
  verifyEmailOtp,
} from "../services/accountIdentity";

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/**
 * 账号会话最长 30 天。
 *
 * 取代旧的一年：一年的 cookie 意味着一台丢失的设备一年内都能进创作内容。
 * 30 天在手机常用性和风险之间取平衡，配合 sessionVersion 可以随时撤销。
 */
const ACCOUNT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 余额不足、需要人工处理时向用户显示的负责人邮箱。 */
const OWNER_CONTACT_EMAIL = "mountionzeng@gmail.com";

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendOtpEmail(to: string, code: string): Promise<void> {
  if (!ENV.resendApiKey) {
    // 本地开发保留日志兜底；生产环境由路由提前阻止“假发送”。
    console.log(`[EmailOTP] Code for ${to}: ${code}`);
    return;
  }
  await axios.post(
    "https://api.resend.com/emails",
    {
      from: ENV.resendFromEmail,
      to: [to],
      subject: "聊会儿登录验证码",
      text: `你的验证码是：${code}\n\n10 分钟内有效。`,
      html: `<p style="font-size:24px;font-weight:bold;letter-spacing:8px">${code}</p><p>10 分钟内有效。</p>`,
    },
    { headers: { Authorization: `Bearer ${ENV.resendApiKey}` } },
  );
}

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "");
}

function getOrigin(req: Request): string {
  if (ENV.appOrigin) {
    return normalizeOrigin(ENV.appOrigin);
  }
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol;
  const host = (req.headers["x-forwarded-host"] as string | undefined) ?? req.get("host");
  return `${proto}://${host}`;
}

function getEmail(req: Request): string {
  return typeof req.body?.email === "string"
    ? req.body.email.trim().toLowerCase()
    : "";
}

function getInviteCode(req: Request): string {
  return typeof req.body?.inviteCode === "string"
    ? req.body.inviteCode.trim()
    : "";
}

async function establishEmailSession(
  req: Request,
  res: Response,
  email: string
): Promise<void> {
  const openId = `email:${email}`;
  await db.upsertUser({
    openId,
    email,
    loginMethod: "email",
    lastSignedIn: new Date(),
  });
  const user = await db.getUserByOpenId(openId);
  if (!user) {
    throw new Error("邮箱用户创建后无法读取");
  }
  await db.bindRedeemedInviteToUser(email, user.id);

  const sessionToken = await sdk.createSessionToken(openId, {
    name: email.split("@")[0],
    expiresInMs: ONE_YEAR_MS,
  });
  const cookieOptions = getSessionCookieOptions(req);
  res.cookie(COOKIE_NAME, sessionToken, {
    ...cookieOptions,
    maxAge: ONE_YEAR_MS,
  });
}

/**
 * 建立账号会话：必要时创建用户、登记邮箱身份，签发带会话版本的 30 天 Cookie。
 *
 * 只在身份已经明确（已登记 identity，或全新邮箱）时调用。历史账号的认领由 U3 的
 * 人工映射负责，不在这里猜。
 */
async function establishAccountSession(
  req: Request,
  res: Response,
  input: { email: string; userId: number | null }
): Promise<{ userId: number }> {
  const openId = `email:${input.email}`;
  await db.upsertUser({
    openId,
    email: input.email,
    loginMethod: "email",
    lastSignedIn: new Date(),
  });
  const user = await db.getUserByOpenId(openId);
  if (!user) throw new Error("邮箱用户创建后无法读取");

  await db.linkEmailIdentity({ userId: user.id, email: input.email });

  const sessionToken = await sdk.createSessionToken(openId, {
    name: input.email.split("@")[0],
    expiresInMs: ACCOUNT_SESSION_TTL_MS,
    sessionVersion: Number(user.sessionVersion ?? 1),
  });
  res.cookie(COOKIE_NAME, sessionToken, {
    ...getSessionCookieOptions(req),
    maxAge: ACCOUNT_SESSION_TTL_MS,
  });
  return { userId: user.id };
}

/** 需要人工映射时的统一响应：告诉用户找谁，而不是让他对着一个死循环重试。 */
function respondNeedsManualMapping(res: Response) {
  res.status(409).json({
    error: "account_needs_manual_setup",
    contactEmail: OWNER_CONTACT_EMAIL,
  });
}

export function registerOAuthRoutes(app: Express) {
  // ── 统一账号：邮箱验证码 ────────────────────────────────────────────
  app.post("/api/auth/account/otp/request", async (req: Request, res: Response) => {
    const email = getEmail(req);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "invalid_email" });
      return;
    }
    const purpose = req.body?.purpose === "recover" ? "recover" : "login";
    const result = await issueEmailOtp({
      email,
      purpose,
      requestIp: clientIp(req),
    });

    if (result.outcome === "rate_limited") {
      res.status(429).json({ error: "rate_limited", retryAfterMs: result.retryAfterMs });
      return;
    }
    if (result.outcome === "not_configured") {
      res.status(503).json({ error: "email_not_configured" });
      return;
    }
    if (result.outcome === "identity_conflict") {
      respondNeedsManualMapping(res);
      return;
    }
    await sendOtpEmail(email, result.otp.code);
    // 无论邮箱是否已有账号，响应都一样——响应差异本身就是枚举信道。
    res.json({ ok: true });
  });

  app.post("/api/auth/account/otp/verify", async (req: Request, res: Response) => {
    const email = getEmail(req);
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!email || !code) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    const verified = await verifyEmailOtp({
      email,
      purpose: "login",
      code,
      requestIp: clientIp(req),
    });

    if (verified.outcome === "rate_limited") {
      res.status(429).json({ error: "rate_limited", retryAfterMs: verified.retryAfterMs });
      return;
    }
    if (
      verified.outcome === "identity_conflict" ||
      verified.outcome === "needs_manual_mapping"
    ) {
      respondNeedsManualMapping(res);
      return;
    }
    if (verified.outcome !== "verified") {
      res.status(401).json({ error: "invalid_or_expired" });
      return;
    }

    await establishAccountSession(req, res, { email, userId: verified.userId });
    res.json({ ok: true });
  });

  // ── 统一账号：密码 ────────────────────────────────────────────────
  app.post("/api/auth/account/password/login", async (req: Request, res: Response) => {
    const email = getEmail(req);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!email || !password) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    const result = await authenticateWithPassword({
      email,
      password,
      requestIp: clientIp(req),
    });

    if (result.outcome === "rate_limited") {
      res.status(429).json({ error: "rate_limited", retryAfterMs: result.retryAfterMs });
      return;
    }
    if (
      result.outcome === "identity_conflict" ||
      result.outcome === "needs_manual_mapping"
    ) {
      respondNeedsManualMapping(res);
      return;
    }
    if (result.outcome !== "authenticated") {
      // 未知邮箱、没设过密码、密码错误一律同一个响应
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }

    await establishAccountSession(req, res, { email, userId: result.userId });
    res.json({ ok: true });
  });

  app.post("/api/auth/account/password/set", async (req: Request, res: Response) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    let userId: number;
    try {
      userId = (await sdk.authenticateRequest(req)).id;
    } catch {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const result = await setAccountPassword({ userId, password });
    if (result.outcome === "rejected") {
      res.status(400).json({ error: result.reason, message: result.message });
      return;
    }
    res.json({ ok: true });
  });

  app.post("/api/auth/account/password/change", async (req: Request, res: Response) => {
    const currentPassword =
      typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
    const nextPassword =
      typeof req.body?.nextPassword === "string" ? req.body.nextPassword : "";
    let user: { id: number; openId: string; email: string | null };
    try {
      const authenticated = await sdk.authenticateRequest(req);
      user = {
        id: authenticated.id,
        openId: authenticated.openId,
        email: authenticated.email,
      };
    } catch {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }

    const result = await changeAccountPassword({
      userId: user.id,
      currentPassword,
      nextPassword,
    });
    if (result.outcome === "invalid_credentials") {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }
    if (result.outcome === "rejected") {
      res.status(400).json({ error: result.reason, message: result.message });
      return;
    }

    // 其他设备已被撤销；当前设备换发一张带新版本号的 Cookie，不用重新登录。
    const sessionToken = await sdk.createSessionToken(user.openId, {
      name: (user.email ?? "").split("@")[0],
      expiresInMs: ACCOUNT_SESSION_TTL_MS,
      sessionVersion: result.sessionVersion,
    });
    res.cookie(COOKIE_NAME, sessionToken, {
      ...getSessionCookieOptions(req),
      maxAge: ACCOUNT_SESSION_TTL_MS,
    });
    res.json({ ok: true });
  });

  app.post(
    "/api/auth/account/password/recover",
    async (req: Request, res: Response) => {
      const email = getEmail(req);
      const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (!email || !code || !password) {
        res.status(400).json({ error: "invalid_request" });
        return;
      }

      const result = await completePasswordRecovery({
        email,
        code,
        nextPassword: password,
        requestIp: clientIp(req),
      });
      if (result.outcome === "rate_limited") {
        res.status(429).json({ error: "rate_limited", retryAfterMs: result.retryAfterMs });
        return;
      }
      if (
        result.outcome === "identity_conflict" ||
        result.outcome === "needs_manual_mapping"
      ) {
        respondNeedsManualMapping(res);
        return;
      }
      if (result.outcome === "rejected") {
        res.status(400).json({ error: result.reason, message: result.message });
        return;
      }
      if (result.outcome !== "recovered") {
        res.status(401).json({ error: "invalid_or_expired" });
        return;
      }

      // 全部旧 session 已撤销，且**不自动登录**：用户必须用新密码正常登录一次。
      res.clearCookie(COOKIE_NAME, getSessionCookieOptions(req));
      res.json({ ok: true });
    }
  );

  app.get("/api/auth/google/config", (req: Request, res: Response) => {
    const redirectUri = `${getOrigin(req)}/api/auth/google/callback`;
    res.setHeader("Cache-Control", "no-store");
    res.json({
      configured: Boolean(ENV.googleClientId && ENV.googleClientSecret),
      redirectUri,
    });
  });

  // ── Google OAuth ────────────────────────────────────────────────────
  app.get("/api/auth/google", (req: Request, res: Response) => {
    if (ENV.betaInviteRequired) {
      res.status(403).json({ error: "invite_required" });
      return;
    }
    if (!ENV.googleClientId) {
      res.status(503).json({ error: "Google OAuth not configured. Set GOOGLE_CLIENT_ID." });
      return;
    }
    const redirectUri = `${getOrigin(req)}/api/auth/google/callback`;
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", ENV.googleClientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("prompt", "select_account");
    res.redirect(302, url.toString());
  });

  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    if (!code) {
      res.redirect(302, "/login?error=missing_code");
      return;
    }
    try {
      const redirectUri = `${getOrigin(req)}/api/auth/google/callback`;

      // Exchange code → tokens
      const tokenRes = await axios.post<{ access_token: string }>(
        "https://oauth2.googleapis.com/token",
        {
          code,
          client_id: ENV.googleClientId,
          client_secret: ENV.googleClientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        },
      );

      // Get user info from Google
      const userRes = await axios.get<{
        sub: string;
        email: string;
        name: string;
      }>("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokenRes.data.access_token}` },
      });

      const { sub, email, name } = userRes.data;
      const openId = `google:${sub}`;
      const existingUser = await db.getUserByOpenId(openId);
      if (ENV.betaInviteRequired && !existingUser) {
        res.redirect(302, "/login?error=invite_required");
        return;
      }

      await db.upsertUser({
        openId,
        name: name || null,
        email: email || null,
        loginMethod: "google",
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(openId, {
        name: name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[Google OAuth] Callback failed", error);
      res.redirect(302, "/login?error=oauth_failed");
    }
  });

  // ── 专属邀请码直接登录 ─────────────────────────────────────────────
  app.post(
    "/api/auth/email/invite-login",
    async (req: Request, res: Response) => {
      const email = getEmail(req);
      const inviteCode = getInviteCode(req);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ error: "invalid_email" });
        return;
      }
      if (!inviteCode) {
        res.status(403).json({ error: "invite_required" });
        return;
      }

      try {
        const claimedInvite = await db.redeemInviteForEmail(
          hashInviteCode(inviteCode),
          email
        );
        if (!claimedInvite) {
          res.status(403).json({ error: "invalid_invite" });
          return;
        }
        await establishEmailSession(req, res, email);
        res.json({ ok: true });
      } catch (error) {
        console.error("[InviteLogin] login failed", error);
        res.status(500).json({ error: "login_failed" });
      }
    }
  );

  // ── Email OTP ────────────────────────────────────────────────────────
  app.post("/api/auth/email/request", async (req: Request, res: Response) => {
    const email = getEmail(req);
    const inviteCode = getInviteCode(req);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "invalid_email" });
      return;
    }
    try {
      if (ENV.betaInviteRequired) {
        if (!inviteCode) {
          res.status(403).json({ error: "invite_required" });
          return;
        }
        const invite = await db.findInviteCodeForEmailAccess(
          hashInviteCode(inviteCode),
          email
        );
        if (!invite) {
          res.status(403).json({ error: "invalid_invite" });
          return;
        }
      }
      if (ENV.isProduction && !ENV.resendApiKey) {
        res.status(503).json({ error: "email_not_configured" });
        return;
      }

      const code = generateOtpCode();
      const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
      await db.createEmailOtp(email, code, expiresAt);
      await sendOtpEmail(email, code);
      res.json({ ok: true });
    } catch (error) {
      console.error("[EmailOTP] request failed", error);
      res.status(500).json({ error: "send_failed" });
    }
  });

  app.post("/api/auth/email/verify", async (req: Request, res: Response) => {
    const email = getEmail(req);
    const inviteCode = getInviteCode(req);
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!email || !code) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    try {
      const otp = await db.findValidEmailOtp(email, code);
      if (!otp) {
        res.status(401).json({ error: "invalid_or_expired" });
        return;
      }

      if (ENV.betaInviteRequired) {
        if (!inviteCode) {
          res.status(403).json({ error: "invite_required" });
          return;
        }
        const claimedInvite = await db.redeemInviteForEmail(
          hashInviteCode(inviteCode),
          email
        );
        if (!claimedInvite) {
          res.status(403).json({ error: "invalid_invite" });
          return;
        }
      }

      await db.markEmailOtpUsed(otp.id);
      await establishEmailSession(req, res, email);
      res.json({ ok: true });
    } catch (error) {
      console.error("[EmailOTP] verify failed", error);
      res.status(500).json({ error: "verify_failed" });
    }
  });

  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      const existingUser = await db.getUserByOpenId(userInfo.openId);
      if (ENV.betaInviteRequired && !existingUser) {
        res.status(403).json({ error: "invite_required" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
