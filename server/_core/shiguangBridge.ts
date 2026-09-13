import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, json, type Request, type Response } from "express";
import type { EmailLinkResult } from "../services/accountIdentity";

type Principal = { id: number; sessionVersion: number };
export type ShiguangBridgeDependencies = {
  enabled: boolean;
  secret: string;
  ready: () => Promise<boolean>;
  allow: (subject: string) => Promise<boolean>;
  resolve: (subject: string) => Promise<number>;
  principal: (userId: number) => Promise<Principal | null | undefined>;
  emailHint: (userId: number) => Promise<string | null>;
  requestOtp: (user: Principal, email: string, requestKey: string) => Promise<"sent" | "rate_limited" | "unavailable">;
  linkEmail: (user: Principal, input: { email: string; otp: string; subject: string }) => Promise<EmailLinkResult>;
  stories: (userId: number, cursor: number) => Promise<{
    stories: Array<{ id: number; title: string }>;
    nextCursor: number | null;
  }>;
  document: (userId: number, storyId: number) => Promise<{ title: string; body: string; bodyAvailable: boolean; sourceRevision: string; sourceUpdatedAt: number } | null>;
  now?: () => number;
};

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

export function bridgeSignature(secret: string, path: string, timestamp: string, nonce: string, body: unknown): string {
  return createHmac("sha256", secret)
    .update(`POST\n${path}\n${timestamp}\n${nonce}\n${canonicalJson(body)}`)
    .digest("hex");
}

function validSignature(req: Request, secret: string, now: number): boolean {
  const timestamp = String(req.header("x-shiguang-timestamp") ?? "");
  const nonce = String(req.header("x-shiguang-nonce") ?? "");
  const signature = String(req.header("x-shiguang-signature") ?? "");
  if (!/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 300_000 ||
      !/^[0-9A-Za-z_-]{16,64}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = bridgeSignature(secret, req.path, timestamp, nonce, req.body);
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
}

function emailFrom(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 320 && /^\S+@\S+\.\S+$/.test(email) ? email : null;
}

export function createShiguangBridgeRouter(deps: ShiguangBridgeDependencies) {
  const router = Router();
  // Reject same-process replays inside the five-minute signature window. The
  // timestamp and subject rate limit remain the cross-process safety net.
  const seenNonces = new Map<string, number>();
  router.use(json({ limit: "8kb" }));
  router.use(async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      if (!deps.enabled || deps.secret.length < 32) return res.status(503).json({ error: "bridge_not_configured" });
      const now = (deps.now ?? Date.now)();
      if (!validSignature(req, deps.secret, now)) return res.status(401).json({ error: "invalid_bridge_signature" });
      const replayKey = `${req.header("x-shiguang-timestamp")}:${req.header("x-shiguang-nonce")}`;
      if (seenNonces.has(replayKey)) return res.status(401).json({ error: "replayed_request" });
      seenNonces.set(replayKey, now);
      if (seenNonces.size > 5_000) {
        for (const [key, seenAt] of seenNonces) if (now - seenAt > 300_000) seenNonces.delete(key);
      }
      const subject = req.body?.subject;
      if (typeof subject !== "string" || !/^shiguang:[0-9a-f]{64}$/.test(subject)) return res.status(400).json({ error: "invalid_input" });
      if (!await deps.allow(subject)) return res.status(429).json({ error: "rate_limited" });
      if (!await deps.ready()) return res.status(503).json({ error: "unavailable" });
      res.locals.shiguangSubject = subject;
      next();
    } catch {
      if (!res.headersSent) res.status(503).json({ error: "unavailable" });
    }
  });
  const endpoint = (handler: (req: Request, res: Response, user: Principal, subject: string) => Promise<void>) =>
    async (req: Request, res: Response) => {
      try {
        const subject = res.locals.shiguangSubject as string;
        const userId = await deps.resolve(subject);
        const user = await deps.principal(userId);
        if (!user) return res.status(503).json({ error: "unavailable" });
        await handler(req, res, user, subject);
      } catch { res.status(503).json({ error: "unavailable" }); }
    };
  router.post("/link/email/otp/request", endpoint(async (req, res, user, subject) => {
    const email = emailFrom(req.body?.email);
    if (!email) return void res.status(400).json({ error: "invalid_input" });
    // Cloud functions share egress IPs. Rate-limit this authenticated request by
    // its opaque WeChat subject instead of making unrelated users block one another.
    const outcome = await deps.requestOtp(user, email, subject);
    if (outcome === "sent") return void res.json({ ok: true });
    res.status(outcome === "rate_limited" ? 429 : 503).json({ error: outcome === "rate_limited" ? outcome : "email_not_configured" });
  }));
  router.post("/link/email", endpoint(async (req, res, user, subject) => {
    const email = emailFrom(req.body?.email), otp = req.body?.otp;
    if (!email || typeof otp !== "string" || !/^\d{6}$/.test(otp)) return void res.status(400).json({ error: "invalid_input" });
    const result = await deps.linkEmail(user, { email, otp, subject });
    if (result.outcome === "linked") return void res.json({ linked: true });
    const status = result.outcome === "session_expired" ? 401 : ["invalid_otp", "invalid_code"].includes(result.outcome) ? 400 : 409;
    res.status(status).json({ error: result.outcome });
  }));
  router.post("/status", endpoint(async (_req, res, user) => {
    const emailHint = await deps.emailHint(user.id);
    res.json({ linked: Boolean(emailHint), emailHint: emailHint ?? "" });
  }));
  router.post("/stories", endpoint(async (req, res, user) => {
    if (!await deps.emailHint(user.id)) return void res.status(409).json({ error: "not_linked" });
    const cursor = req.body?.cursor ?? 0;
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > 1_000_000) {
      return void res.status(400).json({ error: "invalid_input" });
    }
    const page = await deps.stories(user.id, cursor);
    if (Buffer.byteLength(JSON.stringify(page)) > 200 * 1024) {
      return void res.status(413).json({ error: "story_list_too_large" });
    }
    res.json(page);
  }));
  router.post("/stories/read", endpoint(async (req, res, user) => {
    if (!await deps.emailHint(user.id)) return void res.status(409).json({ error: "not_linked" });
    const storyId = req.body?.storyId;
    if (!Number.isSafeInteger(storyId) || storyId <= 0) return void res.status(400).json({ error: "invalid_input" });
    const document = await deps.document(user.id, storyId);
    if (!document) return void res.status(404).json({ error: "not_found" });
    if (document.body.length > 50_000) return void res.status(413).json({ error: "story_too_large" });
    const payload = { id: storyId, ...document };
    if (Buffer.byteLength(JSON.stringify(payload)) > 240 * 1024) {
      return void res.status(413).json({ error: "story_response_too_large" });
    }
    res.json(payload);
  }));
  return router;
}
