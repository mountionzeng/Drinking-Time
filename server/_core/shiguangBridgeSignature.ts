import { createHmac, timingSafeEqual } from "node:crypto";

// Protocol 1.0.0: UTF-16 key ordering (not localeCompare). Callers must use
// JSON-compatible values; undefined array elements are not supported.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

export function bridgeSignature(secret: string, path: string, timestamp: string, nonce: string, body: unknown): string {
  return createHmac("sha256", secret)
    .update(`POST\n${path}\n${timestamp}\n${nonce}\n${canonicalJson(body)}`)
    .digest("hex");
}

export function hasValidBridgeSignature(
  req: { path: string; body: unknown; header(name: string): string | undefined },
  secret: string,
  now: number,
): boolean {
  const timestamp = String(req.header("x-shiguang-timestamp") ?? "");
  const nonce = String(req.header("x-shiguang-nonce") ?? "");
  const signature = String(req.header("x-shiguang-signature") ?? "");
  if (
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > 300_000 ||
    !/^[0-9A-Za-z_-]{16,64}$/.test(nonce) ||
    !/^[0-9a-f]{64}$/.test(signature)
  ) return false;
  const expected = bridgeSignature(secret, req.path, timestamp, nonce, req.body);
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
}
