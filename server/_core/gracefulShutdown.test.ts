import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createInFlightTracker, drainForShutdown, shutdownDrainTimeoutMs } from "./gracefulShutdown";

function fakeResponse() {
  return new EventEmitter() as EventEmitter & { once: EventEmitter["once"] };
}

describe("graceful shutdown", () => {
  it("waits for in-flight requests, then flushes local persistence", async () => {
    const tracker = createInFlightTracker();
    const res = fakeResponse();
    tracker.middleware({} as never, res as never, () => {});
    expect(tracker.active).toBe(1);
    const order: string[] = [];
    const server = { close: vi.fn(() => order.push("close")), closeAllConnections: vi.fn(() => order.push("closeAll")) };
    const flush = vi.fn(async () => { order.push("flush"); });
    const draining = drainForShutdown({ server: server as never, tracker, flush, timeoutMs: 5_000 });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(flush).not.toHaveBeenCalled();
    res.emit("finish");
    res.emit("close"); // counted once
    expect(tracker.active).toBe(0);
    await expect(draining).resolves.toEqual({ timedOut: false, inFlightAtTimeout: 0 });
    expect(order).toEqual(["close", "flush", "closeAll"]);
  });

  it("gives up after the timeout but still tries to flush", async () => {
    const tracker = createInFlightTracker();
    tracker.middleware({} as never, fakeResponse() as never, () => {});
    const flush = vi.fn(async () => {});
    const result = await drainForShutdown({ tracker, flush, timeoutMs: 20 });
    expect(result).toEqual({ timedOut: true, inFlightAtTimeout: 1 });
    expect(flush).toHaveBeenCalled();
  });

  it("reads SHUTDOWN_DRAIN_TIMEOUT_MS with a safe default", () => {
    expect(shutdownDrainTimeoutMs({})).toBe(20_000);
    expect(shutdownDrainTimeoutMs({ SHUTDOWN_DRAIN_TIMEOUT_MS: "5000" })).toBe(5_000);
    expect(shutdownDrainTimeoutMs({ SHUTDOWN_DRAIN_TIMEOUT_MS: "abc" })).toBe(20_000);
  });
});
