import type { ImageProvider, ImageProviderStatus } from "@shared/imageProvider";

/**
 * Per-provider health. Failures are classified so that one slow or crowded
 * upstream (e.g. 302 Midjourney) can never take every image model offline:
 * - content / task_timeout: never count (user prompt issue, or a paid task that may still finish)
 * - overload: short cooldown for that provider only
 * - network: 3 within the window → short cooldown for that provider only
 * - parameter (HTTP 4xx except 429, Invalid_Prompt_Parameter, …): never count —
 *   the request itself was rejected; the provider is healthy for everyone else
 * - fault (5xx / unknown): 3 consecutive → long cooldown for that provider only
 *
 * Health is tracked per provider + model ("midjourney:mj", "gpt-image:gpt-image-2").
 * A provider-level key (no model) is still honoured by every model of that provider,
 * so legacy callers that cannot name a model keep their old behaviour.
 */
export type ProviderFailureKind =
  | "content"
  | "parameter"
  | "task_timeout"
  | "overload"
  | "network"
  | "fault";

/** Bucket for failures not tied to a selectable provider (e.g. Forge). */
type HealthProvider = ImageProvider | "other";
type HealthKey = string;

function healthKey(provider: HealthProvider, model?: string | null): HealthKey {
  const scoped = model?.trim();
  return scoped ? `${provider}:${scoped}` : provider;
}

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
  model?: string;
  message: string;
  failedAt: number;
  kind: ProviderFailureKind;
} | null = null;

/** HTTP 4xx except 429 (429 is upstream overload / rate limit, handled separately). */
const CLIENT_ERROR_STATUS = /\bHTTP\s*(?:4(?:0\d|1\d|2[0-8]|[3-9]\d))\b/i;
const PARAMETER_ERROR =
  /invalid[\s_-]*(?:prompt|parameter|param|argument|request)|bad[\s_-]*request|unprocessable|拒绝了请求参数|参数(?:错误|无效|不合法)|无效(?:的)?(?:prompt|提示词|参数)/i;

export function classifyProviderFailure(message: string): ProviderFailureKind {
  if (
    /violat|banned|prohibit|sensitive|moderation|safety|nsfw|违规|敏感|不合规|审核/i.test(
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
  // Checked before "network": the request reached the provider and was refused
  // on its merits. Counting it would let one bad prompt pause every user.
  if (PARAMETER_ERROR.test(message) || CLIENT_ERROR_STATUS.test(message))
    return "parameter";
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
 * - provider + model: is that provider-level key or that provider+model key cooling
 *   (generation gates use this, so one model never blocks its siblings)
 * - provider only: is that provider or ANY of its models cooling (status display
 *   and legacy callers; conservative)
 * - nothing: is any key cooling
 */
export function isCircuitOpen(provider?: ImageProvider, model?: string | null): boolean {
  if (provider) {
    if (keyOpen(provider)) return true;
    if (model?.trim()) return keyOpen(healthKey(provider, model));
    let anyModelOpen = false;
    for (const key of Array.from(openUntil.keys())) {
      if (key.startsWith(`${provider}:`) && keyOpen(key)) anyModelOpen = true;
    }
    return anyModelOpen;
  }
  let anyOpen = false;
  for (const key of Array.from(openUntil.keys())) {
    if (keyOpen(key)) anyOpen = true;
  }
  return anyOpen;
}

/** Only the provider-level key (failures recorded without a model). */
export function isProviderCircuitOpen(provider: ImageProvider): boolean {
  return keyOpen(provider);
}

export function providerRetryAt(provider?: ImageProvider, model?: string | null): number | null {
  if (provider) {
    const keys = model?.trim()
      ? [provider, healthKey(provider, model)]
      : Array.from(openUntil.keys()).filter(key => key === provider || key.startsWith(`${provider}:`));
    let latest: number | null = null;
    for (const key of keys) if (keyOpen(key)) latest = Math.max(latest ?? 0, openUntil.get(key)!);
    return latest;
  }
  let latest: number | null = null;
  for (const key of Array.from(openUntil.keys())) {
    if (keyOpen(key)) latest = Math.max(latest ?? 0, openUntil.get(key)!);
  }
  return latest;
}

export function recordSuccess(provider: HealthProvider = "other", model?: string | null): void {
  const key = healthKey(provider, model);
  faultCounts.delete(key);
  networkFailures.delete(key);
  if (
    lastProviderFailure?.provider === provider &&
    (lastProviderFailure.model ?? null) === (model?.trim() || null)
  )
    lastProviderFailure = null;
}

/** Unclassified failure (no message): counts as a fault for that provider+model only. */
export function recordFailure(provider: HealthProvider = "other", model?: string | null): void {
  const key = healthKey(provider, model);
  const count = (faultCounts.get(key) ?? 0) + 1;
  faultCounts.set(key, count);
  if (count >= FAULT_THRESHOLD) {
    openUntil.set(key, Date.now() + FAULT_COOLDOWN_MS);
    console.warn(
      `[imageGen] Provider ${key} paused after ${count} consecutive failures`
    );
  }
}

export function recordProviderFailure(
  provider: ImageProvider,
  message: string,
  model?: string | null
): ProviderFailureKind {
  const kind = classifyProviderFailure(message);
  if (kind === "content" || kind === "task_timeout" || kind === "parameter") return kind;
  const key = healthKey(provider, model);
  lastProviderFailure = {
    provider,
    ...(model?.trim() ? { model: model.trim() } : {}),
    message,
    failedAt: Date.now(),
    kind,
  };
  if (kind === "overload") {
    // Submission retries already happened upstream; give the provider a short breather.
    openUntil.set(key, Date.now() + SHORT_COOLDOWN_MS);
    console.warn(`[imageGen] Provider short cooldown (overload): ${key}: ${message}`);
    return kind;
  }
  if (kind === "network") {
    const now = Date.now();
    const recent = (networkFailures.get(key) ?? []).filter(
      at => now - at < NETWORK_WINDOW_MS
    );
    recent.push(now);
    networkFailures.set(key, recent);
    if (recent.length >= NETWORK_THRESHOLD) {
      openUntil.set(key, now + SHORT_COOLDOWN_MS);
      console.warn(`[imageGen] Provider short cooldown (network): ${key}: ${message}`);
    }
    return kind;
  }
  recordFailure(provider, model);
  return kind;
}

/** Read-only snapshot of every cooling key, for local diagnostics (no secrets). */
export function imageProviderHealthSnapshot(): {
  open: Array<{ key: string; retryAt: string }>;
  faultCounts: Array<{ key: string; count: number }>;
  lastFailure: { provider: string; model?: string; kind: ProviderFailureKind; failedAt: string } | null;
} {
  const open: Array<{ key: string; retryAt: string }> = [];
  for (const key of Array.from(openUntil.keys())) {
    if (keyOpen(key)) open.push({ key, retryAt: new Date(openUntil.get(key)!).toISOString() });
  }
  return {
    open,
    faultCounts: Array.from(faultCounts.entries()).map(([key, count]) => ({ key, count })),
    lastFailure: lastProviderFailure
      ? {
          provider: lastProviderFailure.provider,
          ...(lastProviderFailure.model ? { model: lastProviderFailure.model } : {}),
          kind: lastProviderFailure.kind,
          failedAt: new Date(lastProviderFailure.failedAt).toISOString(),
        }
      : null,
  };
}

export function getImageProviderStatus(
  provider?: ImageProvider,
  model?: string | null
): ImageProviderStatus {
  const ready = !isCircuitOpen(provider, model);
  const retryAtMs = providerRetryAt(provider, model);
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

export function circuitBreakerMessage(provider?: ImageProvider, model?: string | null): string {
  const retryAt = providerRetryAt(provider, model);
  const minutes =
    retryAt != null ? Math.max(1, Math.ceil((retryAt - Date.now()) / 60_000)) : null;
  return `${CIRCUIT_BREAKER_PREFIX}，本次未生成，也未扣出图算力。${
    minutes ? `预计约 ${minutes} 分钟后恢复，` : ""
  }请稍后再试。`;
}

/** Structured local cooldown rejection (nothing sent upstream, nothing charged). */
export function providerCooldownRejection(provider?: ImageProvider, model?: string | null): {
  message: string;
  errorCode: "cooling_down";
  retryAt?: string;
} {
  const retryAtMs = providerRetryAt(provider, model);
  return {
    message: circuitBreakerMessage(provider, model),
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
