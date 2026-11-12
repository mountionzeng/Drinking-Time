/**
 * Original provider error, kept with task records so support can see the real
 * upstream code (e.g. Legnext/悠船 "Invalid_Prompt_Parameter", 302 err_code -10003)
 * while the product shows only a short reason. Always sanitized: provider
 * payloads can echo prompts, signed URLs or credentials.
 */
export interface ProviderErrorDetail {
  provider: string;
  httpStatus?: number;
  code?: string;
  message?: string;
}

/** Strip URLs/secrets and cap length; provider payloads can echo prompts or keys. */
export function sanitizeProviderText(value: unknown, max = 200): string | undefined {
  if (value == null) return undefined;
  const text = String(value)
    .replace(/https?:\/\/\S+/gi, "[url]")
    // Upstream trace / request ids identify accounts and requests; never keep them.
    .replace(/\b(?:tid|trace[_ -]?id|request[_ -]?id|req[_ -]?id|x-request-id)\s*[:=]\s*\S+/gi, "")
    .replace(/data:[^\s,]+,[A-Za-z0-9+/=]+/g, "[data]")
    .replace(/\b(?:sk|pk|key|token|bearer)[-_ ]?[A-Za-z0-9_\-]{12,}\b/gi, "[redacted]")
    .replace(/[A-Za-z0-9_\-]{40,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Pull a code/message pair out of the usual provider error envelopes. */
export function providerErrorFromBody(
  provider: string,
  body: unknown,
  httpStatus?: number
): ProviderErrorDetail {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const nested = record.error && typeof record.error === "object" ? (record.error as Record<string, unknown>) : {};
  const code = nested.err_code ?? nested.code ?? nested.type ?? record.err_code ?? record.code ?? record.error_code;
  const message =
    nested.message ?? nested.raw_message ?? record.description ?? record.message ?? record.failReason ??
    (typeof record.error === "string" ? record.error : undefined) ?? record.detail;
  const reason = typeof message === "string" ? /\(reason:\s*([A-Za-z_]+)\)/.exec(message)?.[1] : undefined;
  const detail: ProviderErrorDetail = { provider };
  if (httpStatus != null) detail.httpStatus = httpStatus;
  const codeText = sanitizeProviderText(reason ?? code, 60);
  if (codeText) detail.code = codeText;
  const messageText = sanitizeProviderText(message);
  if (messageText) detail.message = messageText;
  return detail;
}

/** Short user-facing reason, e.g. "HTTP 400 · Invalid_Prompt_Parameter". */
export function shortProviderReason(detail?: ProviderErrorDetail): string {
  if (!detail) return "";
  const parts = [detail.httpStatus != null ? `HTTP ${detail.httpStatus}` : "", detail.code ?? ""]
    .filter(Boolean);
  if (!detail.code && detail.message) parts.push(detail.message.slice(0, 60));
  return parts.join(" · ");
}
