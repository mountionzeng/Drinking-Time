import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { parse as parseCookieHeader } from "cookie";
import { randomUUID } from "node:crypto";
import type { User } from "../../drizzle/schema";
import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const";
import { getUserByOpenId, upsertUser } from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

const GUEST_OPEN_ID_PREFIX = "guest:";
const LEGACY_GUEST_OPEN_ID = "local-guest";

function authDisabled() {
  return (
    process.env.DISABLE_AUTH === "true" ||
    process.env.NODE_ENV !== "production"
  );
}

function readSessionCookie(req: CreateExpressContextOptions["req"]) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const parsed = parseCookieHeader(cookieHeader);
  return parsed[COOKIE_NAME] ?? null;
}

async function loadOrCreateGuestUser(openId: string, name = "Guest") {
  const signedInAt = new Date();
  await upsertUser({
    openId,
    name,
    loginMethod: "guest",
    lastSignedIn: signedInAt,
  });
  const user = await getUserByOpenId(openId);
  if (!user) {
    throw new Error(`访客用户创建失败：${openId}`);
  }
  return user;
}

async function issueBrowserGuestSession(
  opts: CreateExpressContextOptions,
  guestName = "Guest"
): Promise<User> {
  const guestOpenId = `${GUEST_OPEN_ID_PREFIX}${randomUUID()}`;
  const sessionToken = await sdk.createSessionToken(guestOpenId, {
    name: guestName,
    expiresInMs: ONE_YEAR_MS,
  });
  const cookieOptions = getSessionCookieOptions(opts.req);
  if (typeof opts.res.cookie === "function") {
    opts.res.cookie(COOKIE_NAME, sessionToken, {
      ...cookieOptions,
      maxAge: ONE_YEAR_MS,
    });
  }
  return loadOrCreateGuestUser(guestOpenId, guestName);
}

async function resolveDisabledAuthUser(
  opts: CreateExpressContextOptions
): Promise<User> {
  const sessionCookie = readSessionCookie(opts.req);
  const session = await sdk.verifySession(sessionCookie);

  if (session?.openId?.startsWith(GUEST_OPEN_ID_PREFIX)) {
    return loadOrCreateGuestUser(session.openId, session.name || "Guest");
  }

  if (session?.openId === LEGACY_GUEST_OPEN_ID) {
    // 旧版全站共用 local-guest。这里直接升级到浏览器独立访客，避免继续串号。
    return issueBrowserGuestSession(opts, "Guest");
  }

  if (session) {
    try {
      return await sdk.authenticateRequest(opts.req);
    } catch {
      // 登录 cookie 过期/异常时，降级为独立访客，不把整站打死。
    }
  }

  return issueBrowserGuestSession(opts, "Guest");
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  if (!authDisabled()) {
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch (error) {
      // Authentication is optional for public procedures.
      user = null;
    }
  } else {
    user = await resolveDisabledAuthUser(opts);
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
