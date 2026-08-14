import type { ImageProvider, ImageProviderStatus } from "@shared/imageProvider";

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 10 * 60 * 1000;

let consecutiveFailures = 0;
let circuitBreakerOpenUntil: number | null = null;
const providerOpenUntil = new Map<ImageProvider, number>();
let lastProviderFailure: {
  provider: ImageProvider;
  message: string;
  failedAt: number;
} | null = null;

export function isCircuitOpen(provider?: ImageProvider): boolean {
  if (circuitBreakerOpenUntil !== null) {
    if (Date.now() >= circuitBreakerOpenUntil) {
      circuitBreakerOpenUntil = null;
      consecutiveFailures = 0;
    } else {
      return true;
    }
  }
  if (provider) {
    const openUntil = providerOpenUntil.get(provider);
    if (!openUntil) return false;
    if (Date.now() >= openUntil) {
      providerOpenUntil.delete(provider);
      return false;
    }
    return true;
  }
  for (const candidate of Array.from(providerOpenUntil.keys())) {
    if (isCircuitOpen(candidate)) return true;
  }
  return false;
}

export function recordSuccess(): void {
  consecutiveFailures = 0;
  circuitBreakerOpenUntil = null;
  lastProviderFailure = null;
}

export function recordFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreakerOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    console.warn(
      `[imageGen] Circuit breaker opened after ${consecutiveFailures} consecutive failures`
    );
  }
}

export function recordProviderFailure(
  provider: ImageProvider,
  message: string
): void {
  lastProviderFailure = { provider, message, failedAt: Date.now() };
  if (
    /timeout|超时|no available models|当前无可用模型|HTTP (?:429|5\d\d)/i.test(
      message
    )
  ) {
    consecutiveFailures = Math.max(
      consecutiveFailures,
      CIRCUIT_BREAKER_THRESHOLD
    );
    providerOpenUntil.set(provider, Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS);
    console.warn(
      `[imageGen] Provider cooldown opened: ${provider}: ${message}`
    );
    return;
  }
  recordFailure();
}

export function getImageProviderStatus(): ImageProviderStatus {
  const ready = !isCircuitOpen();
  const retryAtMs =
    circuitBreakerOpenUntil ??
    (lastProviderFailure
      ? providerOpenUntil.get(lastProviderFailure.provider)
      : undefined) ??
    null;
  return {
    ready,
    reason: ready
      ? null
      : (lastProviderFailure?.message ??
        "图片供应商连续失败，付费生成已暂时停用"),
    retryAt:
      !ready && retryAtMs != null ? new Date(retryAtMs).toISOString() : null,
    lastFailure: lastProviderFailure
      ? {
          provider: lastProviderFailure.provider,
          message: lastProviderFailure.message,
          failedAt: new Date(lastProviderFailure.failedAt).toISOString(),
        }
      : null,
  };
}

export function circuitBreakerMessage(provider?: ImageProvider): string {
  const status = getImageProviderStatus();
  const providerReason =
    provider && status.lastFailure?.provider === provider
      ? status.lastFailure.message
      : null;
  return providerReason || status.reason
    ? `图片付费生成暂时停用：${providerReason ?? status.reason}`
    : "图片付费生成暂时停用";
}

/** Reset the process-local provider state between tests. */
export function resetCircuitBreaker(): void {
  consecutiveFailures = 0;
  circuitBreakerOpenUntil = null;
  providerOpenUntil.clear();
  lastProviderFailure = null;
}
