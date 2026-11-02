import type { ImageProvider, ImageProviderStatus } from "@shared/imageProvider";

/**
 * Per-provider health. Failures are classified so that one slow or crowded
 * upstream (e.g. 302 Midjourney) can never take every image model offline:
 * - content / task_timeout: never count (user prompt issue, or a paid task that may still finish)
 * - overload: short cooldown for that provider only
 * - network: 3 within the window → short cooldown for that provider only
 * - fault (5xx / auth / unknown): 3 consecutive → long cooldown for that provider only
 */
export type ProviderFailureKind =
  | "content"
  | "task_timeout"
  | "overload"
  | "network"
  | "fault";

/** Bucket for failures not tied to a selectable provider (e.g. Forge). */
type HealthKey = ImageProvider | "other";

export const FAULT_THRESHOLD = 3;
export const FAULT_COOLDOWN_MS = 10 * 60 * 1000;
export const SHORT_COOLDOWN_MS = 60 * 1000;
export const NETWORK_THRESHOLD = 3;
export const NETWORK_WINDOW_MS = 60 * 1000;

const faultCounts = new Map<HealthKey, number>();
const networkFailures = new Map<HealthKey, number[]>();
const openUntil = new Map<HealthKey, number>();
let lastProviderFailure: {
  provider: ImageProvider;
  message: string;
  failedAt: number;
  kind: ProviderFailureKind;
} | null = null;

export function classifyProviderFailure(message: string): ProviderFailureKind {
  if (
    /violat|banned|prohibit|sensitive|moderation|safety|nsfw|invalid (?:prompt|parameter)|违规|敏感|不合规|审核/i.test(
      message
    )
  )
    return "content";
  if (/task timeout|任务超时|仍在生成|还在排队/i.test(message))
    return "task_timeout";
  if (
    /overloaded|过载|拥挤|拥堵|no available models|当前无可用模型|HTTP 429|限流/i.test(
      message
    )
  )
    return "overload";
  if (
    /timeout|超时|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|无法连接|连接/i.test(
      message
    )
  )
    return "network";
  return "fault";
}

function keyOpen(key: HealthKey): boolean {
  const until = openUntil.get(key);
  if (until == null) return false;
  if (Date.now() >= until) {
    openUntil.delete(key);
    faultCounts.delete(key);
    networkFailures.delete(key);
    return false;
  }
  return true;
}

/**
 * With a provider: is that provider cooling down. Without: is any provider
 * cooling down (status display only; generation paths always pass a provider).
 */
export function isCircuitOpen(provider?: ImageProvider): boolean {
  if (provider) return keyOpen(provider);
  let anyOpen = false;
  for (const key of Array.from(openUntil.keys())) {
    if (keyOpen(key)) anyOpen = true;
  }
  return anyOpen;
}

export function providerRetryAt(provider?: ImageProvider): number | null {
  if (provider) return keyOpen(provider) ? openUntil.get(provider)! : null;
  let latest: number | null = null;
  for (const key of Array.from(openUntil.keys())) {
    if (keyOpen(key)) latest = Math.max(latest ?? 0, openUntil.get(key)!);
  }
  return latest;
}

export function recordSuccess(provider: HealthKey = "other"): void {
  faultCounts.delete(provider);
  networkFailures.delete(provider);
  if (lastProviderFailure?.provider === provider) lastProviderFailure = null;
}

/** Unclassified failure (no message): counts as a fault for that provider only. */
export function recordFailure(provider: HealthKey = "other"): void {
  const count = (faultCounts.get(provider) ?? 0) + 1;
  faultCounts.set(provider, count);
  if (count >= FAULT_THRESHOLD) {
    openUntil.set(provider, Date.now() + FAULT_COOLDOWN_MS);
    console.warn(
      `[imageGen] Provider ${provider} paused after ${count} consecutive failures`
    );
  }
}

export function recordProviderFailure(
  provider: ImageProvider,
  message: string
): ProviderFailureKind {
  const kind = classifyProviderFailure(message);
  if (kind === "content" || kind === "task_timeout") return kind;
  lastProviderFailure = { provider, message, failedAt: Date.now(), kind };
  if (kind === "overload") {
    // Submission retries already happened upstream; give the provider a short breather.
    openUntil.set(provider, Date.now() + SHORT_COOLDOWN_MS);
    console.warn(`[imageGen] Provider short cooldown (overload): ${provider}: ${message}`);
    return kind;
  }
  if (kind === "network") {
    const now = Date.now();
    const recent = (networkFailures.get(provider) ?? []).filter(
      at => now - at < NETWORK_WINDOW_MS
    );
    recent.push(now);
    networkFailures.set(provider, recent);
    if (recent.length >= NETWORK_THRESHOLD) {
      openUntil.set(provider, now + SHORT_COOLDOWN_MS);
      console.warn(`[imageGen] Provider short cooldown (network): ${provider}: ${message}`);
    }
    return kind;
  }
  recordFailure(provider);
  return kind;
}

export function getImageProviderStatus(
  provider?: ImageProvider
): ImageProviderStatus {
  const ready = !isCircuitOpen(provider);
  const retryAtMs = providerRetryAt(provider);
  const failure =
    lastProviderFailure && (!provider || lastProviderFailure.provider === provider)
      ? lastProviderFailure
      : null;
  return {
    ready,
    reason: ready
      ? null
      : (failure?.message ?? "图片供应商连续失败，付费生成已暂时停用"),
    retryAt:
      !ready && retryAtMs != null ? new Date(retryAtMs).toISOString() : null,
    lastFailure: failure
      ? {
          provider: failure.provider,
          message: failure.message,
          failedAt: new Date(failure.failedAt).toISOString(),
        }
      : null,
  };
}

/** Prefix used by every cooldown rejection; the client matches on errorCode, not text. */
export const CIRCUIT_BREAKER_PREFIX = "图片服务当前拥挤，暂时停止提交";

export function circuitBreakerMessage(provider?: ImageProvider): string {
  const retryAt = providerRetryAt(provider);
  const minutes =
    retryAt != null ? Math.max(1, Math.ceil((retryAt - Date.now()) / 60_000)) : null;
  return `${CIRCUIT_BREAKER_PREFIX}，本次未生成，也未扣出图算力。${
    minutes ? `预计约 ${minutes} 分钟后恢复，` : ""
  }请稍后再试。`;
}

/** Structured local cooldown rejection (nothing sent upstream, nothing charged). */
export function providerCooldownRejection(provider?: ImageProvider): {
  message: string;
  errorCode: "cooling_down";
  retryAt?: string;
} {
  const retryAtMs = providerRetryAt(provider);
  return {
    message: circuitBreakerMessage(provider),
    errorCode: "cooling_down",
    ...(retryAtMs != null ? { retryAt: new Date(retryAtMs).toISOString() } : {}),
  };
}

/** Reset the process-local provider state between tests. */
export function resetCircuitBreaker(): void {
  faultCounts.clear();
  networkFailures.clear();
  openUntil.clear();
  lastProviderFailure = null;
}
