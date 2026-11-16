import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { accountIdentities, platformRegistrationChallenges } from "../../drizzle/schema";
import { getDb, transientState, type PlatformRegistrationChallenge } from "./runtime";

export const PLATFORM_REGISTRATION_TTL_MS = 10 * 60 * 1000;
export const PLATFORM_REGISTRATION_COOKIE = "dt_platform_reg";

let tail: Promise<unknown> = Promise.resolve();

function serial<T>(action: () => Promise<T>): Promise<T> {
  const run = tail.then(action, action);
  tail = run.then(() => undefined, () => undefined);
  return run;
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hashesMatch(expectedHex: string, suppliedHex: string) {
  const expected = Buffer.from(expectedHex, "hex");
  const supplied = Buffer.from(suppliedHex, "hex");
  return expected.length === supplied.length && expected.length > 0 && timingSafeEqual(expected, supplied);
}

export function parsePlatformRegistrationCookie(value: string | undefined) {
  if (!value) return null;
  const [id, secret, openIdEncoded] = value.split(".");
  if (!id || !secret || !openIdEncoded || value.split(".").length !== 3) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id) || secret.length < 32) return null;
  const openId = Buffer.from(openIdEncoded, "base64url").toString("utf8");
  if (!openId || openId.length > 64) return null;
  return { id, secret, openId };
}

function cookieValue(id: string, secret: string, openId: string) {
  return `${id}.${secret}.${Buffer.from(openId, "utf8").toString("base64url")}`;
}

function toRow(input: {
  id: string;
  browserHash: string;
  openIdHash: string;
  name: string | null;
  loginMethod: string | null;
  expiresAt: Date | number;
  consumedAt: Date | number | null;
  otpChannel: "email" | "phone" | null;
  otpSubjectHash: string | null;
  otpCodeHash: string | null;
  otpExpiresAt: Date | number | null;
  otpAttempts: number;
}): PlatformRegistrationChallenge {
  const expiresAt = input.expiresAt instanceof Date ? input.expiresAt.getTime() : input.expiresAt;
  const consumedAt = input.consumedAt instanceof Date ? input.consumedAt.getTime() : input.consumedAt;
  const otpExpiresAt = input.otpExpiresAt instanceof Date ? input.otpExpiresAt.getTime() : input.otpExpiresAt;
  return {
    id: input.id,
    browserHash: input.browserHash,
    openIdHash: input.openIdHash,
    name: input.name,
    loginMethod: input.loginMethod,
    expiresAt,
    consumedAt,
    otp: input.otpChannel && input.otpSubjectHash && input.otpCodeHash && otpExpiresAt
      ? { channel: input.otpChannel, subjectHash: input.otpSubjectHash, codeHash: input.otpCodeHash, expiresAt: otpExpiresAt, attempts: input.otpAttempts }
      : null,
  };
}

function persistentFields(row: PlatformRegistrationChallenge) {
  return {
    name: row.name,
    loginMethod: row.loginMethod,
    consumedAt: row.consumedAt ? new Date(row.consumedAt) : null,
    otpChannel: row.otp?.channel ?? null,
    otpSubjectHash: row.otp?.subjectHash ?? null,
    otpCodeHash: row.otp?.codeHash ?? null,
    otpExpiresAt: row.otp ? new Date(row.otp.expiresAt) : null,
    otpAttempts: row.otp?.attempts ?? 0,
  };
}

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function accepted(row: PlatformRegistrationChallenge, secret: string, openId: string, now: number) {
  if (row.consumedAt) return "missing" as const;
  if (!hashesMatch(row.browserHash, sha256Hex(secret)) || !hashesMatch(row.openIdHash, sha256Hex(openId))) return "missing" as const;
  if (row.expiresAt <= now) return "expired" as const;
  return null;
}

export async function insertPlatformRegistration(input: {
  openId: string;
  name: string | null;
  loginMethod: string | null;
  now: number;
}) {
  const secret = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const row = toRow({
    id,
    browserHash: sha256Hex(secret),
    openIdHash: sha256Hex(input.openId),
    name: input.name,
    loginMethod: input.loginMethod,
    expiresAt: input.now + PLATFORM_REGISTRATION_TTL_MS,
    consumedAt: null,
    otpChannel: null,
    otpSubjectHash: null,
    otpCodeHash: null,
    otpExpiresAt: null,
    otpAttempts: 0,
  });
  const db = await getDb();
  if (!db) {
    transientState.platformRegistrationChallenges.push(row);
  } else {
    await db.insert(platformRegistrationChallenges).values({
      id: row.id,
      browserHash: row.browserHash,
      openIdHash: row.openIdHash,
      name: row.name,
      loginMethod: row.loginMethod,
      expiresAt: new Date(row.expiresAt),
      consumedAt: null,
      otpAttempts: 0,
    });
  }
  return { cookieValue: cookieValue(id, secret, input.openId), expiresAt: row.expiresAt };
}

export type PlatformRegistrationView =
  | { status: "missing" }
  | { status: "expired" }
  | { status: "pending"; expiresAt: number };

async function readRow(id: string) {
  const db = await getDb();
  if (!db) return transientState.platformRegistrationChallenges.find(item => item.id === id) ?? null;
  const [row] = await db.select().from(platformRegistrationChallenges).where(eq(platformRegistrationChallenges.id, id)).limit(1);
  return row ? toRow(row) : null;
}

export async function viewPlatformRegistration(cookie: string | undefined, now: number): Promise<PlatformRegistrationView> {
  const parsed = parsePlatformRegistrationCookie(cookie);
  if (!parsed) return { status: "missing" };
  const row = await readRow(parsed.id);
  if (!row) return { status: "missing" };
  const rejected = accepted(row, parsed.secret, parsed.openId, now);
  if (rejected === "expired") return { status: "expired" };
  if (rejected) return { status: "missing" };
  return { status: "pending", expiresAt: row.expiresAt };
}

export async function cancelPlatformRegistration(cookie: string | undefined, now: number) {
  const parsed = parsePlatformRegistrationCookie(cookie);
  if (!parsed) return;
  const db = await getDb();
  if (!db) {
    const row = transientState.platformRegistrationChallenges.find(item => item.id === parsed.id);
    if (!row || accepted(row, parsed.secret, parsed.openId, now)) return;
    row.consumedAt = now;
    row.otp = null;
    return;
  }
  await db.transaction(async tx => {
    const locked = await lockPlatformRegistration(tx, cookie, now);
    if (locked.status !== "ok") return;
    locked.row.consumedAt = now;
    locked.row.otp = null;
    await savePlatformRegistration(tx, locked.row);
  });
}

export async function lockPlatformRegistration(tx: Transaction, cookie: string | undefined, now: number) {
  const parsed = parsePlatformRegistrationCookie(cookie);
  if (!parsed) return { status: "missing" as const };
  const [stored] = await tx.select().from(platformRegistrationChallenges)
    .where(eq(platformRegistrationChallenges.id, parsed.id)).for("update").limit(1);
  if (!stored) return { status: "missing" as const };
  const row = toRow(stored);
  const rejected = accepted(row, parsed.secret, parsed.openId, now);
  if (rejected) return { status: rejected };
  return { status: "ok" as const, row, openId: parsed.openId };
}

export async function savePlatformRegistration(tx: Transaction, row: PlatformRegistrationChallenge) {
  await tx.update(platformRegistrationChallenges).set(persistentFields(row)).where(eq(platformRegistrationChallenges.id, row.id));
}

export async function findLoginIdentityForUpdate(tx: Transaction, provider: "email" | "phone", subject: string) {
  const [owner] = await tx.select({ userId: accountIdentities.userId }).from(accountIdentities).where(and(
    eq(accountIdentities.provider, provider),
    eq(accountIdentities.subject, subject),
  )).for("update").limit(1);
  return owner?.userId ?? null;
}

export async function mutatePlatformRegistration<T>(
  cookie: string | undefined,
  now: number,
  action: (row: PlatformRegistrationChallenge, openId: string) => Promise<T> | T,
): Promise<{ status: "missing" | "expired" } | { status: "ok"; value: T }> {
  const parsed = parsePlatformRegistrationCookie(cookie);
  if (!parsed) return { status: "missing" };
  const db = await getDb();
  if (!db) {
    return serial(async () => {
      const row = transientState.platformRegistrationChallenges.find(item => item.id === parsed.id);
      if (!row) return { status: "missing" };
      const rejected = accepted(row, parsed.secret, parsed.openId, now);
      if (rejected) return { status: rejected };
      return { status: "ok", value: await action(row, parsed.openId) };
    });
  }
  return db.transaction(async tx => {
    const locked = await lockPlatformRegistration(tx, cookie, now);
    if (locked.status !== "ok") return { status: locked.status };
    const value = await action(locked.row, locked.openId);
    await savePlatformRegistration(tx, locked.row);
    return { status: "ok" as const, value };
  });
}
