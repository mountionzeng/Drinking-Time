import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FAULT_COOLDOWN_MS,
  SHORT_COOLDOWN_MS,
  classifyProviderFailure,
  getImageProviderStatus,
  imageProviderHealthSnapshot,
  isCircuitOpen,
  isProviderCircuitOpen,
  providerCooldownRejection,
  providerRetryAt,
  recordFailure,
  recordProviderFailure,
  recordSuccess,
  resetCircuitBreaker,
} from "./imageProviderHealth";

describe("image provider health", () => {
  afterEach(() => {
    resetCircuitBreaker();
    vi.useRealTimers();
  });

  it("treats 4xx parameter errors as request errors, not provider faults", () => {
    expect(classifyProviderFailure("302 Midjourney submit HTTP 400")).toBe("parameter");
    expect(classifyProviderFailure("MJ 供应商拒绝请求（HTTP 422 · Invalid_Prompt_Parameter）")).toBe("parameter");
    expect(classifyProviderFailure("failed to create task (reason: Invalid_Prompt_Parameter)")).toBe("parameter");
    expect(classifyProviderFailure("生成服务拒绝了请求参数（HTTP 400）。")).toBe("parameter");
    expect(classifyProviderFailure("302 Midjourney submit HTTP 429")).toBe("overload");
    expect(classifyProviderFailure("302 GPT-image 暂时不可用（HTTP 503）。")).toBe("fault");
    for (let i = 0; i < 10; i++) {
      expect(recordProviderFailure("midjourney", "302 Midjourney submit HTTP 400", "mj")).toBe("parameter");
    }
    expect(isCircuitOpen("midjourney")).toBe(false);
    expect(isCircuitOpen("midjourney", "mj")).toBe(false);
    expect(getImageProviderStatus().lastFailure).toBeNull();
  });

  it("scopes faults to provider + model", () => {
    for (let i = 0; i < 3; i++) recordProviderFailure("gpt-image", "HTTP 500", "gpt-image-2");
    expect(isCircuitOpen("gpt-image", "gpt-image-2")).toBe(true);
    expect(isCircuitOpen("gpt-image", "flux-kontext-pro")).toBe(false);
    // Provider-only status is conservative (some model is cooling) …
    expect(isCircuitOpen("gpt-image")).toBe(true);
    // … but the provider-level key itself is not open.
    expect(isProviderCircuitOpen("gpt-image")).toBe(false);
    expect(providerCooldownRejection("gpt-image", "gpt-image-2").errorCode).toBe("cooling_down");
    recordSuccess("gpt-image", "flux-kontext-pro");
    expect(isCircuitOpen("gpt-image", "gpt-image-2")).toBe(true);
    expect(imageProviderHealthSnapshot().open.map(item => item.key)).toEqual(["gpt-image:gpt-image-2"]);
  });

  it("a provider-level fault (legacy caller without model) still blocks every model", () => {
    for (let i = 0; i < 3; i++) recordFailure("midjourney");
    expect(isCircuitOpen("midjourney", "mj")).toBe(true);
    expect(isCircuitOpen("midjourney", "mj-turbo")).toBe(true);
  });

  it("classifies failures", () => {
    expect(classifyProviderFailure("302 Midjourney task timeout")).toBe("task_timeout");
    expect(classifyProviderFailure("prompt violates content policy")).toBe("content");
    expect(classifyProviderFailure("The model is overloaded")).toBe("overload");
    expect(classifyProviderFailure("302 Midjourney submit HTTP 429")).toBe("overload");
    expect(classifyProviderFailure("fetch failed ECONNRESET")).toBe("network");
    expect(classifyProviderFailure("HTTP 500")).toBe("fault");
  });

  it("does not cool down on task timeouts or content violations", () => {
    for (let i = 0; i < 5; i++) {
      recordProviderFailure("midjourney", "302 Midjourney task timeout");
      recordProviderFailure("midjourney", "内容违规");
    }
    expect(isCircuitOpen("midjourney")).toBe(false);
    expect(getImageProviderStatus().ready).toBe(true);
  });

  it("gives an overload a short per-provider cooldown that does not stop other models", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    recordProviderFailure("midjourney", "The model is overloaded");
    expect(isCircuitOpen("midjourney")).toBe(true);
    expect(isCircuitOpen("gpt-image")).toBe(false);
    expect(providerRetryAt("midjourney")).toBe(Date.now() + SHORT_COOLDOWN_MS);
    const rejection = providerCooldownRejection("midjourney");
    expect(rejection.errorCode).toBe("cooling_down");
    expect(rejection.message).toContain("未扣出图算力");
    expect(rejection.message).toContain("1 分钟");
    vi.advanceTimersByTime(SHORT_COOLDOWN_MS);
    expect(isCircuitOpen("midjourney")).toBe(false);
  });

  it("cools network errors down only after 3 within the window", () => {
    recordProviderFailure("gpt-image", "fetch failed");
    recordProviderFailure("gpt-image", "fetch failed");
    expect(isCircuitOpen("gpt-image")).toBe(false);
    recordProviderFailure("gpt-image", "fetch failed");
    expect(isCircuitOpen("gpt-image")).toBe(true);
    expect(isCircuitOpen("midjourney")).toBe(false);
  });

  it("opens a 10-minute fault cooldown after 3 consecutive faults, reset by success", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    recordFailure("fal");
    recordFailure("fal");
    recordSuccess("fal");
    recordFailure("fal");
    recordFailure("fal");
    expect(isCircuitOpen("fal")).toBe(false);
    recordFailure("fal");
    expect(isCircuitOpen("fal")).toBe(true);
    expect(providerRetryAt("fal")).toBe(Date.now() + FAULT_COOLDOWN_MS);
    expect(isCircuitOpen("midjourney")).toBe(false);
    vi.advanceTimersByTime(FAULT_COOLDOWN_MS);
    expect(isCircuitOpen("fal")).toBe(false);
  });
});
