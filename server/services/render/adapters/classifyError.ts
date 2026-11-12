/**
 * One error classification for every adapter. HTTP status first, then the
 * provider's own code, then wording — so a 400 parameter refusal is never
 * counted as an outage (see imageProviderHealth: parameter errors do not trip
 * the breaker for anyone else).
 */
import { classifyProviderFailure, type ProviderFailureKind } from "../../imageProviderHealth";
import { providerErrorFromBody, shortProviderReason, type ProviderErrorDetail } from "../../providerError";

export type RenderErrorClass = {
  kind: ProviderFailureKind;
  providerError: ProviderErrorDetail;
  /** Short, sanitized reason for the user-facing message. */
  reason: string;
};

export function classifyRenderError(provider: string, input: { httpStatus?: number; body?: unknown; message?: string }): RenderErrorClass {
  const providerError = providerErrorFromBody(provider, input.body ?? null, input.httpStatus);
  const reason = shortProviderReason(providerError);
  const text = [input.httpStatus != null ? `HTTP ${input.httpStatus}` : "", providerError.code ?? "", providerError.message ?? "", input.message ?? ""]
    .filter(Boolean).join(" ");
  return { kind: classifyProviderFailure(text), providerError, reason };
}
