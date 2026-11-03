/**
 * Diagnostic only: record which file host/path 302 hands back so the
 * domestic-mirror question can be verified against real data. Never logs the
 * query string or fragment (signatures/tokens), never throws, never changes
 * the URL that callers go on to use.
 */
export type Provider302FileKind = "audio" | "image" | "video";

export function redact302FileUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return null;
  }
}

export function log302FileUrl(
  kind: Provider302FileKind,
  raw: unknown,
  logger: (line: string) => void = line => console.info(line)
): void {
  try {
    const safe = redact302FileUrl(raw);
    if (!safe) return;
    logger(`[302-file-url] kind=${kind} url=${safe}`);
  } catch {
    // Logging must never affect generation or download.
  }
}
