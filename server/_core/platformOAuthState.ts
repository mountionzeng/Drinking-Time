import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { claimShiguangBridgeNonce } from "../repositories/shiguangBridgeNonces";
import { registrationDatabase } from "../repositories/registrationDatabase";

export const PLATFORM_OAUTH_COOKIE = "dt_platform_oauth";
export const PLATFORM_OAUTH_STATE_TTL_MS = 5 * 60_000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const localClaims = new Map<string, number>();

function signature(state: string, expires: string, redirectUri: string, key: string) {
  return createHmac("sha256", key).update(JSON.stringify(["platform-oauth:v1", state, expires, redirectUri])).digest("base64url");
}

export function issuePlatformOAuthState(redirectUri: string, key: string, now = Date.now()) {
  const state = randomBytes(32).toString("base64url");
  const expires = String(now + PLATFORM_OAUTH_STATE_TTL_MS);
  return { state, cookie: `${expires}.${signature(state, expires, redirectUri, key)}` };
}

export async function consumePlatformOAuthState(input: {
  state: string | undefined;
  cookie: string | undefined;
  redirectUri: string;
  key: string;
  now?: number;
}) {
  const { state, cookie, redirectUri, key, now = Date.now() } = input;
  if (!state || !TOKEN.test(state) || !cookie || !key) return false;
  const parts = cookie.split(".");
  const [expires, signed] = parts;
  if (parts.length !== 2 || !/^\d{13}$/.test(expires) || !TOKEN.test(signed) ||
      Number(expires) <= now || Number(expires) > now + PLATFORM_OAUTH_STATE_TTL_MS) return false;
  const expected = signature(state, expires, redirectUri, key);
  if (!timingSafeEqual(Buffer.from(signed), Buffer.from(expected))) return false;

  const db = await registrationDatabase();
  if (db) return claimShiguangBridgeNonce("platform-oauth:v1", state, now);
  for (const [id, expiry] of localClaims) {
    if (expiry <= now) localClaims.delete(id);
  }
  if (localClaims.has(state)) return false;
  localClaims.set(state, Number(expires));
  return true;
}
