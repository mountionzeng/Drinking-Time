import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { transientState, type PlatformRegistrationChallenge } from "./runtime";

export const PLATFORM_REGISTRATION_TTL_MS = 10 * 60 * 1000;
export const PLATFORM_REGISTRATION_COOKIE = "dt_platform_reg";

let tail: Promise<unknown> = Promise.resolve();

function serial<T>(action: () => Promise<T>): Promise<T> {
  const run = tail.then(action, action);
  tail = run.then(() => undefined, () => undefined);
  return run;
}

function hashBrowser(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

function browserMatches(row: PlatformRegistrationChallenge, secret: string) {
  const expected = Buffer.from(row.browserHash, "hex");
  const supplied = Buffer.from(hashBrowser(secret), "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function parsePlatformRegistrationCookie(value: string | undefined) {
  if (!value) return null;
  const split = value.indexOf(".");
  if (split <= 0 || split === value.length - 1) return null;
  const id = value.slice(0, split);
  const secret = value.slice(split + 1);
  if (!/^[0-9a-f-]{36}$/i.test(id) || secret.length < 32) return null;
  return { id, secret };
}

export async function insertPlatformRegistration(input: {
  openId: string;
  name: string | null;
  loginMethod: string | null;
  now: number;
}) {
  return serial(async () => {
    const secret = randomBytes(32).toString("base64url");
    const id = randomUUID();
    const row: PlatformRegistrationChallenge = {
      id,
      openId: input.openId,
      name: input.name,
      loginMethod: input.loginMethod,
      browserHash: hashBrowser(secret),
      expiresAt: input.now + PLATFORM_REGISTRATION_TTL_MS,
      consumedAt: null,
      otp: null,
    };
    transientState.platformRegistrationChallenges.push(row);
    return { cookieValue: `${id}.${secret}`, expiresAt: row.expiresAt };
  });
}

export type PlatformRegistrationView =
  | { status: "missing" }
  | { status: "expired" }
  | { status: "pending"; expiresAt: number };

export async function viewPlatformRegistration(cookie: string | undefined, now: number): Promise<PlatformRegistrationView> {
  return serial(async () => {
    const parsed = parsePlatformRegistrationCookie(cookie);
    if (!parsed) return { status: "missing" };
    const row = transientState.platformRegistrationChallenges.find(item => item.id === parsed.id);
    if (!row || row.consumedAt || !browserMatches(row, parsed.secret)) return { status: "missing" };
    if (row.expiresAt <= now) return { status: "expired" };
    return { status: "pending", expiresAt: row.expiresAt };
  });
}

export async function cancelPlatformRegistration(cookie: string | undefined, now: number) {
  return serial(async () => {
    const parsed = parsePlatformRegistrationCookie(cookie);
    if (!parsed) return;
    const row = transientState.platformRegistrationChallenges.find(item => item.id === parsed.id);
    if (!row || !browserMatches(row, parsed.secret) || row.consumedAt) return;
    row.consumedAt = now;
    row.otp = null;
  });
}

export async function mutatePlatformRegistration<T>(
  cookie: string | undefined,
  now: number,
  action: (row: PlatformRegistrationChallenge) => Promise<T> | T,
): Promise<{ status: "missing" | "expired" } | { status: "ok"; value: T }> {
  return serial(async () => {
    const parsed = parsePlatformRegistrationCookie(cookie);
    if (!parsed) return { status: "missing" };
    const row = transientState.platformRegistrationChallenges.find(item => item.id === parsed.id);
    if (!row || row.consumedAt || !browserMatches(row, parsed.secret)) return { status: "missing" };
    if (row.expiresAt <= now) return { status: "expired" };
    return { status: "ok", value: await action(row) };
  });
}
