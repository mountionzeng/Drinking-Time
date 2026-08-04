import type {
  ImageProvider,
  ImageProviderStatus,
} from "@shared/imageProvider";

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 10 * 60 * 1000;

let consecutiveFailures = 0;
let circuitBreakerOpenUntil: number | null = null;
let lastProviderFailure: {
  provider: ImageProvider;
  message: string;
  failedAt: number;
} | null = null;

export function isCircuitOpen(): boolean {
  if (circuitBreakerOpenUntil === null) return false;
  if (Date.now() >= circuitBreakerOpenUntil) {
    circuitBreakerOpenUntil = null;
    consecutiveFailures = 0;
    return false;
  }
  return true;
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
    circuitBreakerOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    console.warn(`[imageGen] Provider cooldown opened: ${provider}: ${message}`);
    return;
  }
  recordFailure();
}

export function getImageProviderStatus(): ImageProviderStatus {
  const ready = !isCircuitOpen();
  return {
    ready,
    reason: ready
      ? null
      : lastProviderFailure?.message ??
        "图片供应商连续失败，付费生成已暂时停用",
    retryAt:
      !ready && circuitBreakerOpenUntil != null
        ? new Date(circuitBreakerOpenUntil).toISOString()
        : null,
    lastFailure: lastProviderFailure
      ? {
          provider: lastProviderFailure.provider,
          message: lastProviderFailure.message,
          failedAt: new Date(lastProviderFailure.failedAt).toISOString(),
        }
      : null,
  };
}

export function circuitBreakerMessage(): string {
  const status = getImageProviderStatus();
  return status.reason
    ? `图片付费生成暂时停用：${status.reason}`
    : "图片付费生成暂时停用";
}

/** Reset the process-local provider state between tests. */
export function resetCircuitBreaker(): void {
  consecutiveFailures = 0;
  circuitBreakerOpenUntil = null;
  lastProviderFailure = null;
}
