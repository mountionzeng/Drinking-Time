/**
 * 账号认证的密码学与策略原语。
 *
 * 不碰数据库、不碰 HTTP，只回答三件事：这个密码能不能用、怎么存、验证码摘要怎么算。
 *
 * 依据：OWASP Password Storage / Forgot Password Cheat Sheet 与 NIST SP 800-63B——
 * 长度优先于字符组合，慢哈希加随机盐，验证码只存摘要且一次性。
 */
import {
  createHmac,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/** promisify 会挑到不带 options 的重载，这里显式包一层保住工作因子参数。 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derived) =>
      error ? reject(error) : resolve(derived)
    );
  });
}

/** 长度按码点算：一个 emoji 是 1 个字符，不是 2 个。 */
export const MIN_PASSWORD_LENGTH = 15;
/** 上限只为挡住拿超长串打 scrypt 的资源消耗，不是安全要求。 */
export const MAX_PASSWORD_LENGTH = 1024;

const SCRYPT_VERSION = 1;
const SCRYPT_PARAMS = { N: 16_384, r: 8, p: 1, keylen: 64 } as const;

/**
 * 已知弱口令的基词。
 *
 * 15 位下限本身已经挡掉了绝大多数常见口令，这里针对的是「长但仍然弱」的形态：
 * 把一个常见词重复几遍凑长度。
 */
const WEAK_BASE_WORDS = [
  "password",
  "qwerty",
  "admin",
  "letmein",
  "iloveyou",
  "welcome",
  "abc123",
  "drinkingtime",
  "changeme",
];

const KEYBOARD_RUNS = [
  "qwertyuiopasdfghjklzxcvbnm",
  "1234567890".repeat(6),
  "abcdefghijklmnopqrstuvwxyz",
];

export type PasswordPolicyResult =
  | { ok: true }
  | { ok: false; reason: "too_short" | "too_long" | "too_weak"; message: string };

/**
 * 密码在存储和校验前统一做 **NFC** 归一化。
 *
 * NFC 只做正规等价（canonical）折叠：`é` 的单码点形式与 `e + U+0301` 组合形式
 * 是同一个字符的两种编码，用户换个输入法就可能打出另一种，必须能登录。
 *
 * 刻意**不用** NFKC：它还会做兼容等价折叠，把 `ﬁ` 连字变成 `fi`、全角 `ａ` 变成 `a`、
 * `①` 变成 `1`。那些是**不同的字符**，把它们当成同一个密码等于悄悄削减了密码空间，
 * 用户以为自己用了一个特殊字符，实际上被折叠掉了。
 */
function normalizePassword(password: string): string {
  return password.normalize("NFC");
}

function codePointLength(value: string): number {
  return [...value].length;
}

function isSingleRepeatedCodePoint(value: string): boolean {
  const points = [...value];
  return points.length > 1 && points.every(point => point === points[0]);
}

function isSequentialRun(lowercase: string): boolean {
  if (lowercase.length < 6) return false;
  return KEYBOARD_RUNS.some(run => run.includes(lowercase));
}

function isRepeatedWeakWord(lowercase: string): boolean {
  const stripped = lowercase.replace(/\d+$/, "") || lowercase;
  return WEAK_BASE_WORDS.some(word => {
    if (stripped.length === 0 || stripped.length % word.length !== 0) return false;
    return stripped === word.repeat(stripped.length / word.length);
  });
}

export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  const normalized = normalizePassword(password);
  const length = codePointLength(normalized);

  if (length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: "too_short",
      message: `密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符。长一点比复杂一点更安全，可以用一句你记得住的话。`,
    };
  }
  if (length > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: "too_long",
      message: `密码不能超过 ${MAX_PASSWORD_LENGTH} 个字符。`,
    };
  }

  const lowercase = normalized.toLowerCase();
  if (
    isSingleRepeatedCodePoint(normalized) ||
    isSequentialRun(lowercase) ||
    isRepeatedWeakWord(lowercase)
  ) {
    return {
      ok: false,
      reason: "too_weak",
      message: "这个密码太容易猜到了（重复字符、键盘顺序或常见词的重复）。换一句只有你会想到的话。",
    };
  }

  return { ok: true };
}

/** 生成 `scrypt$v1$N$r$p$salt$hash` 形式的版本化 record。参数升级时提升版本号重算。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = SCRYPT_PARAMS;
  const derived = await scryptAsync(normalizePassword(password), salt, keylen, {
    N,
    r,
    p,
  });
  return [
    "scrypt",
    `v${SCRYPT_VERSION}`,
    N,
    r,
    p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export function passwordRecordVersion(record: string): number | null {
  const match = /^scrypt\$v(\d+)\$/.exec(record);
  return match ? Number(match[1]) : null;
}

/**
 * 校验密码。
 *
 * 任何格式问题都返回 false 而不是抛异常——登录接口不应该因为一条坏 record 变成 500，
 * 也不应该用异常类型泄露账号状态。比较用 constant-time。
 */
export async function verifyPassword(
  password: string,
  record: string
): Promise<boolean> {
  const parts = record.split("$");
  if (parts.length !== 7 || parts[0] !== "scrypt") return false;
  if (passwordRecordVersion(record) !== SCRYPT_VERSION) return false;

  const N = Number(parts[2]);
  const r = Number(parts[3]);
  const p = Number(parts[4]);
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) {
    return false;
  }

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[5], "base64");
    expected = Buffer.from(parts[6], "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const derived = await scryptAsync(
      normalizePassword(password),
      salt,
      expected.length,
      { N, r, p }
    );
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export type OtpPurpose = "login" | "verify" | "recover";

/** 均匀分布的 6 位验证码。不要用 Math.random。 */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function normalizeEmailForDigest(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * 验证码摘要。
 *
 * 用带服务端 secret 的 HMAC 而不是裸哈希：6 位码只有 100 万种可能，
 * 裸摘要泄库之后可以在一秒内枚举完。摘要同时绑定邮箱、用途和 secret 版本，
 * 所以一个码不能跨用途或跨账号重放，secret 也可以轮换。
 */
export function hashOtpCode(input: {
  code: string;
  email: string;
  purpose: OtpPurpose;
  secret: string;
  version: number;
}): string {
  if (!input.secret.trim()) {
    // 失败关闭：没有 secret 时绝不退化成无密钥哈希。
    throw new Error(
      "缺少验证码摘要 secret：没有它就只剩可离线枚举的裸哈希，宁可不可用也不降级。"
    );
  }
  const payload = [
    input.version,
    input.purpose,
    normalizeEmailForDigest(input.email),
    input.code.trim(),
  ].join(":");
  return createHmac("sha256", input.secret).update(payload, "utf8").digest("hex");
}

export function otpDigestMatches(input: {
  code: string;
  email: string;
  purpose: OtpPurpose;
  secret: string;
  version: number;
  digest: string;
}): boolean {
  let computed: string;
  try {
    computed = hashOtpCode(input);
  } catch {
    return false;
  }
  const stored = input.digest.trim().toLowerCase();
  if (stored.length !== computed.length || stored.length === 0) return false;
  return timingSafeEqual(Buffer.from(computed, "utf8"), Buffer.from(stored, "utf8"));
}
