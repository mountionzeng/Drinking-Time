import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import axios from "axios";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { ENV } from "./env";
import { hashInviteCode } from "../services/inviteAccess";

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const INVITE_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const INVITE_EMAIL_ATTEMPT_LIMIT = 8;
const INVITE_IP_ATTEMPT_LIMIT = 30;

type AttemptBucket = { count: number; resetAt: number };
const inviteLoginAttempts = new Map<string, AttemptBucket>();

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
    { headers: { Authorization: `Bearer ${ENV.resendApiKey}` } }
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
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol;
  const host =
    (req.headers["x-forwarded-host"] as string | undefined) ?? req.get("host");
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

async function emailAlreadyHasAccess(email: string): Promise<boolean> {
  const [user, redeemedInvite] = await Promise.all([
    db.getUserByOpenId(`email:${email}`),
    db.hasRedeemedInviteForEmail(email),
  ]);
  return Boolean(user || redeemedInvite);
}

function readAttemptBucket(key: string): AttemptBucket {
  const now = Date.now();
  const current = inviteLoginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    const fresh = { count: 0, resetAt: now + INVITE_ATTEMPT_WINDOW_MS };
    inviteLoginAttempts.set(key, fresh);
    return fresh;
  }
  return current;
}

function inviteAttemptKeys(req: Request, email: string): string[] {
  return [`email:${email}`, `ip:${req.ip || "unknown"}`];
}

function isInviteLoginRateLimited(req: Request, email: string): boolean {
  const [emailBucket, ipBucket] = inviteAttemptKeys(req, email).map(
    readAttemptBucket
  );
  return (
    emailBucket.count >= INVITE_EMAIL_ATTEMPT_LIMIT ||
    ipBucket.count >= INVITE_IP_ATTEMPT_LIMIT
  );
}

function recordInviteLoginFailure(req: Request, email: string): void {
  for (const key of inviteAttemptKeys(req, email)) {
    readAttemptBucket(key).count += 1;
  }
}

function clearInviteLoginAttempts(req: Request, email: string): void {
  for (const key of inviteAttemptKeys(req, email)) {
    inviteLoginAttempts.delete(key);
  }
}

async function createEmailSession(
  req: Request,
  res: Response,
  email: string,
  loginMethod: "email" | "invite"
): Promise<void> {
  const openId = `email:${email}`;
  await db.upsertUser({
    openId,
    email,
    loginMethod,
    lastSignedIn: new Date(),
  });
  const user = await db.getUserByOpenId(openId);
  if (!user) {
    throw new Error("邀请码用户创建后无法读取");
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

export function registerOAuthRoutes(app: Express) {
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
    if (!ENV.googleClientId) {
      res
        .status(503)
        .json({ error: "Google OAuth not configured. Set GOOGLE_CLIENT_ID." });
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
        }
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
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[Google OAuth] Callback failed", error);
      res.redirect(302, "/login?error=oauth_failed");
    }
  });

  // ── 邀请码直接登录 ───────────────────────────────────────────────────
  app.post("/api/auth/invite/login", async (req: Request, res: Response) => {
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
    if (isInviteLoginRateLimited(req, email)) {
      res.status(429).json({ error: "too_many_attempts" });
      return;
    }

    try {
      const codeHash = hashInviteCode(inviteCode);
      const existingUser = await db.getUserByOpenId(`email:${email}`);
      const invite = existingUser
        ? await db.findRedeemedInviteForEmail(codeHash, email)
        : await db.redeemInviteForEmail(codeHash, email);

      if (!invite) {
        recordInviteLoginFailure(req, email);
        res.status(403).json({ error: "invalid_invite" });
        return;
      }

      await createEmailSession(req, res, email, "invite");
      clearInviteLoginAttempts(req, email);
      res.json({ ok: true });
    } catch (error) {
      console.error("[InviteLogin] failed", error);
      res.status(500).json({ error: "login_failed" });
    }
  });

  // ── Email OTP（保留兼容，不再作为前端默认入口）──────────────────────
  app.post("/api/auth/email/request", async (req: Request, res: Response) => {
    const email = getEmail(req);
    const inviteCode = getInviteCode(req);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "invalid_email" });
      return;
    }
    try {
      if (ENV.betaInviteRequired && !(await emailAlreadyHasAccess(email))) {
        if (!inviteCode) {
          res.status(403).json({ error: "invite_required" });
          return;
        }
        const invite = await db.findAvailableInviteCode(
          hashInviteCode(inviteCode)
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

      if (ENV.betaInviteRequired && !(await emailAlreadyHasAccess(email))) {
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
      await createEmailSession(req, res, email, "email");
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
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
