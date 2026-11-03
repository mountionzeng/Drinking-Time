/**
 * Unified stale-reservation fallback (decision only, no I/O).
 * Evidence first: stored output -> settle at quote; output seen but not stored -> manual
 * (keep hold); no evidence -> release. A provider task still in flight is never touched.
 */
export const INFERENCE_STALE_MS = 10 * 60_000;
export const MEDIA_STALE_MS = 30 * 60_000;
/** A task id that has been "in flight" this long is no longer trusted: hand to a human. */
export const IN_FLIGHT_CAP_MS = 24 * 60 * 60_000;

const MEDIA_PREFIXES = ["media.", "audio.", "tts.", "image", "video", "music", "shiguang."];
export function isMediaOperationType(operationType: string) {
  return MEDIA_PREFIXES.some(p => operationType.startsWith(p));
}
export function staleThresholdMs(operationType: string) {
  return isMediaOperationType(operationType) ? MEDIA_STALE_MS : INFERENCE_STALE_MS;
}

export const OPEN_STATUSES = ["created", "reserved", "submitted", "submission_unknown"] as const;

export type StaleEvidence = {
  /** Output is durably stored (asset / receipt URL / succeeded inference attempt). */
  storedOutput: boolean;
  /** Provider produced something we saw but never stored. */
  outputUnstored: boolean;
  /** A provider task id exists and its own poller still treats it as running. */
  taskInFlight: boolean;
  /** Verified cost of a succeeded inference attempt, if any. */
  verifiedCostMinor?: number | null;
};

export type StaleDecision =
  | { action: "skip"; reason: string }
  | { action: "settle"; reason: string; verifiedCostMinor: number | null }
  | { action: "manual"; reason: string }
  | { action: "release"; reason: string };

export function decideStaleRelease(input: {
  status: string; operationType: string; createdAt: Date; now: Date; holdActive: boolean; evidence: StaleEvidence;
}): StaleDecision {
  if (!(OPEN_STATUSES as readonly string[]).includes(input.status)) return { action: "skip", reason: `已终态 ${input.status}` };
  if (!input.holdActive) return { action: "skip", reason: "无有效预占" };
  const age = input.now.getTime() - input.createdAt.getTime();
  if (age < staleThresholdMs(input.operationType)) return { action: "skip", reason: "未超时" };
  const e = input.evidence;
  if (e.storedOutput) return { action: "settle", reason: "stale-release: 产出已入库，按报价/核验费用结算，不退款", verifiedCostMinor: e.verifiedCostMinor ?? null };
  if (e.taskInFlight) {
    return age < IN_FLIGHT_CAP_MS
      ? { action: "skip", reason: "有任务号，由原轮询路径处理" }
      : { action: "manual", reason: "stale-release: 任务号超过 24 小时仍未结束，保留预占转人工" };
  }
  if (e.outputUnstored) return { action: "manual", reason: "stale-release: 有产出证据但未入库，保留预占转人工" };
  return { action: "release", reason: `stale-release: 超过 ${Math.round(staleThresholdMs(input.operationType) / 60_000)} 分钟无产出证据，释放预占` };
}
