import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getImageProviderStatus,
  isCircuitOpen,
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

  it("opens after three ordinary failures and resets after success", () => {
    recordFailure();
    recordFailure();
    expect(isCircuitOpen()).toBe(false);
    recordFailure();
    expect(isCircuitOpen()).toBe(true);

    recordSuccess();
    expect(getImageProviderStatus()).toMatchObject({ ready: true });
  });

  it("opens immediately for a provider timeout and reports its source", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T08:00:00.000Z"));
    recordProviderFailure("midjourney", "task timeout");

    expect(getImageProviderStatus()).toMatchObject({
      ready: false,
      reason: "task timeout",
      retryAt: "2026-08-01T08:10:00.000Z",
      lastFailure: {
        provider: "midjourney",
        message: "task timeout",
        failedAt: "2026-08-01T08:00:00.000Z",
      },
    });
  });

  it("closes automatically after the cooldown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T08:00:00.000Z"));
    recordProviderFailure("gpt-image", "HTTP 502");
    vi.advanceTimersByTime(10 * 60 * 1000);

    expect(getImageProviderStatus().ready).toBe(true);
  });
});
