/** First release supports mainland China mobile numbers only. */
export function normalizeLoginPhone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 32) return null;
  const compact = value.trim().replace(/[ ()-]/g, "");
  const national = compact.startsWith("+86") ? compact.slice(3) : compact;
  return /^1[3-9]\d{9}$/.test(national) ? `+86${national}` : null;
}

export const PHONE_CODE_TTL_MS = 5 * 60_000;
export const PHONE_RESEND_MS = 60_000;
