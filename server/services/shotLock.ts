/** Pure shot-lock rules shared by storyboardImageTask and scripts/render-selfcheck.ts. */
export type ShotLockTask = {
  status: "preparing" | "unknown" | "accepted" | "failed" | "succeeded";
  analysisStartedAt?: number;
  meta?: { paletteAnalysis?: unknown };
  providerTaskId?: string;
  providerResultUrl?: string;
  createdAt?: number;
  leaseUntil?: number;
};

/** Lease held by the request that is preparing/submitting; renewed on each state change. */
export const SHOT_LOCK_LEASE_MS = 300_000;
/**
 * A task that may have reached the provider without a receipt ("unknown") keeps
 * the shot blocked this long, so a paid job that is still running cannot be
 * bought twice. This age is diagnostic only, not proof that a paid job failed.
 */
export const UNKNOWN_TASK_STALE_MS = 30 * 60_000;
/**
 * Request-scoped shot lock: a task without a provider receipt only blocks its
 * shot while its holder's lease is alive. "preparing" never reached the
 * provider, so it is released as soon as the lease lapses (crash / restart);
 * "unknown" remains protected until reconciliation or the existing explicit
 * new-intent confirmation. A known output is recoverable even without a receipt.
 */
export function staleShotLockReason(task: ShotLockTask, now = Date.now()): string | null {
  if (task.analysisStartedAt || task.meta?.paletteAnalysis || task.providerTaskId || task.providerResultUrl || task.status === "failed" || task.status === "succeeded" || task.status === "accepted") return null;
  const leaseAlive = (task.leaseUntil ?? 0) > now;
  if (leaseAlive) return null;
  if (task.status === "preparing") return "上次生成在准备阶段中断（服务重启或超时），尚未提交图片任务，已自动释放镜头锁。";
  return null;
}
