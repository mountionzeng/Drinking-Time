import type { Server } from "node:http";
import type { NextFunction, Request, Response } from "express";

/**
 * Counts HTTP requests that have not finished yet. Shutdown waits for them so a
 * restart (tsx watch, deploy) does not cut a paid-task submission or a story
 * write in half.
 */
export function createInFlightTracker() {
  let active = 0;
  let waiters: Array<() => void> = [];
  const settle = () => {
    if (active !== 0) return;
    const ready = waiters;
    waiters = [];
    for (const resolve of ready) resolve();
  };
  return {
    middleware(_req: Request, res: Response, next: NextFunction) {
      active += 1;
      let finished = false;
      const end = () => {
        if (finished) return;
        finished = true;
        active -= 1;
        settle();
      };
      res.once("finish", end);
      res.once("close", end);
      next();
    },
    get active() {
      return active;
    },
    idle(): Promise<void> {
      if (active === 0) return Promise.resolve();
      return new Promise(resolve => waiters.push(resolve));
    },
  };
}

export type InFlightTracker = ReturnType<typeof createInFlightTracker>;

export const DEFAULT_SHUTDOWN_DRAIN_MS = 20_000;

export function shutdownDrainTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.SHUTDOWN_DRAIN_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SHUTDOWN_DRAIN_MS;
}

/**
 * Stop accepting connections, wait (bounded) for in-flight requests and then
 * for pending local persistence writes, then drop whatever is left.
 */
export async function drainForShutdown(params: {
  server?: Pick<Server, "close"> & Partial<Pick<Server, "closeIdleConnections" | "closeAllConnections">>;
  tracker: Pick<InFlightTracker, "idle" | "active">;
  flush: () => Promise<void>;
  timeoutMs: number;
}): Promise<{ timedOut: boolean; inFlightAtTimeout: number }> {
  const { server, tracker, flush, timeoutMs } = params;
  server?.close();
  server?.closeIdleConnections?.();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">(resolve => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const drained = (async () => {
    await tracker.idle();
    // Requests finished; their writes are scheduled. Wait for them to land.
    await flush().catch(() => {});
    return "drained" as const;
  })();
  const outcome = await Promise.race([drained, timeout]);
  if (timer) clearTimeout(timer);
  const inFlightAtTimeout = outcome === "timeout" ? tracker.active : 0;
  if (outcome === "timeout") {
    // Still try to land whatever writes are pending, briefly.
    await Promise.race([flush().catch(() => {}), new Promise(resolve => setTimeout(resolve, 2_000))]);
  }
  server?.closeAllConnections?.();
  return { timedOut: outcome === "timeout", inFlightAtTimeout };
}
