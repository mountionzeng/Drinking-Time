import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeInviteCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "");
}

export function hashInviteCode(value: string): string {
  return createHash("sha256")
    .update(normalizeInviteCode(value), "utf8")
    .digest("hex");
}

/**
 * 只用于诊断历史遗留记录：把原码逐字（保留空白、横线和大小写）做 SHA-256。
 *
 * 测试站那条邀请码的摘要就是这样手工生成的，而登录端在验证前一定会先
 * `normalizeInviteCode`，所以正确原码永远算不出库里那个值。产品代码不要用它做校验，
 * 它存在的唯一目的是让修复脚本能够**证明**旧摘要正处于这个已知故障状态。
 */
export function unnormalizedInviteCodeDigest(value: string): string {
  return createHash("sha256").update(value.trim(), "utf8").digest("hex");
}

function digestsEqual(left: string, right: string): boolean {
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/** 创建端、登录端和修复脚本共用的唯一校验入口。 */
export function inviteCodeMatchesDigest(
  rawCode: string,
  digest: string
): boolean {
  return digestsEqual(hashInviteCode(rawCode), digest.trim().toLowerCase());
}

export type InviteCodeDigestKind =
  | "authoritative"
  | "unnormalized-legacy"
  | "unrelated";

/**
 * 判断一条记录的 codeHash 相对于某个原码处于哪种状态。
 * `unnormalized-legacy` 表示这条记录能且只能靠改摘要修复，不需要换码。
 */
export function classifyInviteCodeDigest(
  rawCode: string,
  storedDigest: string
): InviteCodeDigestKind {
  const stored = storedDigest.trim().toLowerCase();
  if (inviteCodeMatchesDigest(rawCode, stored)) return "authoritative";

  const trimmed = rawCode.trim();
  const legacyCandidates = [trimmed, trimmed.toUpperCase(), trimmed.toLowerCase()];
  for (const candidate of legacyCandidates) {
    if (digestsEqual(unnormalizedInviteCodeDigest(candidate), stored)) {
      return "unnormalized-legacy";
    }
  }
  return "unrelated";
}

/** 给运维核对用的短指纹：只来自摘要，永远不包含原码。 */
export function inviteDigestFingerprint(digest: string): string {
  const normalized = digest.trim().toLowerCase();
  return normalized.length === 0 ? "(empty)" : normalized.slice(0, 12);
}

function randomInviteSegment(length: number): string {
  const bytes = randomBytes(length);
  return Array.from(
    bytes,
    byte => INVITE_ALPHABET[byte % INVITE_ALPHABET.length]
  ).join("");
}

export function generateInviteCode(): string {
  return `LH-${randomInviteSegment(4)}-${randomInviteSegment(4)}`;
}
