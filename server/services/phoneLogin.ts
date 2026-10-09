import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  normalizeLoginPhone,
  PHONE_CODE_TTL_MS,
  PHONE_RESEND_MS,
} from "../../shared/phoneLogin";
import {
  consumePersistentRateLimit,
  getLoginIdentity,
  linkLoginIdentity,
} from "../repositories/accounts";
import {
  getUserById,
  getUserByOpenId,
  upsertUser,
} from "../repositories/users";
import {
  consumePhoneChallenge,
  markPhoneChallengeSent,
  replacePhoneChallenge,
} from "../repositories/phoneLogin";
import { generateOtpCode } from "./accountSecurity";
import { getDb } from "../repositories/runtime";
import {
  phoneSmsConfig,
  phoneSmsConfigured,
  sendPhoneLoginSms,
} from "./phoneSms";

export class PhoneLoginError extends Error {
  constructor(
    public code: string,
    public status: number,
    public retryAfterMs?: number
  ) {
    super(code);
  }
}

async function phoneInput(value: unknown) {
  const phone = normalizeLoginPhone(value);
  if (!phone) throw new PhoneLoginError("invalid_phone", 400);
  if (!phoneSmsConfigured())
    throw new PhoneLoginError("sms_not_configured", 503);
  if (process.env.NODE_ENV === "production" && !(await getDb()))
    throw new PhoneLoginError("phone_login_unavailable", 503);
  return phone;
}
function digest(phone: string, challengeId: string, code: string) {
  return createHmac("sha256", phoneSmsConfig().digestSecret)
    .update(`phone-login:v1:${phone}:${challengeId}:${code}`)
    .digest("hex");
}
async function limit(
  scope: string,
  subject: string,
  windowSeconds: number,
  maxAttempts: number
) {
  const result = await consumePersistentRateLimit({
    scope: `phone:${scope}`,
    subject,
    windowSeconds,
    maxAttempts,
  });
  if (!result.allowed)
    throw new PhoneLoginError("rate_limited", 429, result.retryAfterMs);
}
const privateSubject = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function requestPhoneLoginCode(value: unknown, ip: string) {
  const phone = await phoneInput(value);
  // IP first prevents a single requester from creating unlimited per-phone limiter rows.
  await limit("send:ip", privateSubject(ip), 3600, 20);
  await limit("send:minute", privateSubject(phone), 60, 1);
  await limit("send:day", privateSubject(phone), 86400, 10);
  // Rejected resends must not exhaust the shared daily sending budget.
  await limit("send:global", "all", 86400, 500);
  const code = generateOtpCode(),
    challengeId = randomUUID();
  await replacePhoneChallenge({
    phone,
    challengeId,
    codeHash: digest(phone, challengeId, code),
    expiresAt: new Date(Date.now() + PHONE_CODE_TTL_MS),
    attemptCount: 0,
    sentAt: null,
    consumedAt: null,
  });
  try {
    await sendPhoneLoginSms(phone, code);
  } catch {
    throw new PhoneLoginError("sms_send_failed", 502);
  }
  await markPhoneChallengeSent(phone, challengeId);
  return { ok: true, retryAfterMs: PHONE_RESEND_MS };
}

export async function verifyPhoneLoginCode(
  value: unknown,
  code: unknown,
  ip: string
) {
  const phone = await phoneInput(value);
  if (typeof code !== "string" || !/^\d{6}$/.test(code))
    throw new PhoneLoginError("invalid_code", 400);
  await limit("verify:ip", privateSubject(ip), 600, 60);
  await limit("verify:phone", privateSubject(phone), 600, 20);
  const consumed = await consumePhoneChallenge(phone, row => {
    const expected = Buffer.from(row.codeHash, "hex");
    const supplied = Buffer.from(digest(phone, row.challengeId, code), "hex");
    return (
      expected.length === supplied.length && timingSafeEqual(expected, supplied)
    );
  });
  if (!consumed) throw new PhoneLoginError("invalid_or_expired", 401);
  const identity = await getLoginIdentity("phone", phone);
  if (identity) {
    if (!(await getUserById(identity.userId)))
      throw new PhoneLoginError("account_needs_manual_setup", 409);
    return identity.userId;
  }
  // Stable opaque openId + unique identity prevent parallel registrations creating two users.
  // No email/WeChat matching, merging or signup credit grants.
  const openId = `phone:${privateSubject(phone)}`;
  await upsertUser({
    openId,
    loginMethod: "phone",
    role: "user",
    lastSignedIn: new Date(),
  });
  const user = await getUserByOpenId(openId);
  if (!user) throw new Error("phone_account_unavailable");
  const linked = await linkLoginIdentity({
    userId: user.id,
    provider: "phone",
    subject: phone,
  });
  if (linked.kind === "taken")
    throw new PhoneLoginError("account_needs_manual_setup", 409);
  return user.id;
}
