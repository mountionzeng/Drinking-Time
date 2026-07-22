import { createHash, randomBytes } from "node:crypto";

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeInviteCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "");
}

export function hashInviteCode(value: string): string {
  return createHash("sha256")
    .update(normalizeInviteCode(value), "utf8")
    .digest("hex");
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
