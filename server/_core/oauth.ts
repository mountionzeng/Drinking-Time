import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import axios from "axios";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { ENV } from "./env";

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendOtpEmail(to: string, code: string): Promise<void> {
  if (!ENV.resendApiKey) {
    // Dev fallback: log to console when Resend not configured
    console.log(`[EmailOTP] Code for ${to}: ${code}`);
    return;
  }
  await axios.post(
    "https://api.resend.com/emails",
    {
      from: ENV.resendFromEmail,
      to: [to],
      subject: "你的登录验证码 / Your login code",
      text: `你的验证码是：${code}\n\nYour code: ${code}\n\n10分钟内有效。`,
      html: `<p style="font-size:24px;font-weight:bold;letter-spacing:8px">${code}</p><p>10分钟内有效 / Valid for 10 minutes</p>`,
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


  // ── Email OTP ────────────────────────────────────────────────────────
  app.post("/api/auth/email/request", async (req: Request, res: Response) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "invalid_email" });
      return;
    }
    try {
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
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
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
      await db.markEmailOtpUsed(otp.id);

      const openId = `email:${email}`;
      await db.upsertUser({
        openId,
        email,
        loginMethod: "email",
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(openId, {
        name: email.split("@")[0],
        expiresInMs: ONE_YEAR_MS,
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
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
