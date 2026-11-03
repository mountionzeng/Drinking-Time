/**
 * Pure rules for durable image generation tasks. No I/O here.
 *
 * Safety invariants (inherited from 1d79e444):
 *  - A task with a providerTaskId, or whose submission outcome is unknown,
 *    is never submitted to the provider again.
 *  - Final settlement happens at most once per task (settlement column + the
 *    billing ledger's own terminal-status idempotency).
 */
import type { BookModuleImageTask } from "./bookModuleImageTask";

export const IMAGE_TASK_STATUSES = [
  "submitting", // claimed; provider POST may be in flight
  "accepted", // provider returned a task id; poll only
  "submission_unknown", // request sent, no receipt; never resubmit
  "succeeded",
  "failed",
] as const;
export type ImageTaskStatus = (typeof IMAGE_TASK_STATUSES)[number];
export type ImageTaskScope = "book_module" | "cover" | "mobile";
export type ImageTaskSettlement = "charged" | "released" | "manual";

const TERMINAL = new Set<ImageTaskStatus>(["succeeded", "failed"]);
export const isTerminalImageTask = (s: ImageTaskStatus) => TERMINAL.has(s);

const ALLOWED: Record<ImageTaskStatus, readonly ImageTaskStatus[]> = {
  submitting: ["accepted", "submission_unknown", "failed", "succeeded"],
  accepted: ["succeeded", "failed"],
  // A late receipt may still be attached (e.g. found in provider dashboard).
  submission_unknown: ["accepted", "failed"],
  succeeded: [],
  failed: [],
};
export function canTransition(from: ImageTaskStatus, to: ImageTaskStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** Resubmitting is only ever allowed for a task that definitely never reached the provider. */
export function mayResubmit(task: { status: ImageTaskStatus; providerTaskId?: string | null }): boolean {
  return task.status === "failed" && !task.providerTaskId;
}

export type UpstreamPollResult =
  | { kind: "completed"; candidateCount: number }
  | { kind: "failed" } // provider confirmed failure
  | { kind: "pending" }; // not done, or transient fetch error

export type PollDecision =
  | { action: "succeed"; settle: "charge" }
  | { action: "fail"; settle: "release" }
  | { action: "reschedule"; delayMs: number }
  | { action: "manual" };

export const POLL_MAX_AGE_MS = 30 * 60_000;
export function pollDelayMs(pollCount: number): number {
  return Math.min(15_000 * 2 ** Math.max(0, pollCount - 4), 120_000);
}

/** What to do with one accepted task after querying the provider. */
export function decidePoll(
  task: { status: ImageTaskStatus; providerTaskId?: string | null; pollCount: number; submittedAt: Date | null; createdAt: Date },
  result: UpstreamPollResult,
  now: Date,
): PollDecision {
  if (task.status !== "accepted" || !task.providerTaskId) return { action: "manual" };
  if (result.kind === "completed") {
    return result.candidateCount > 0 ? { action: "succeed", settle: "charge" } : { action: "reschedule", delayMs: pollDelayMs(task.pollCount + 1) };
  }
  // Provider-confirmed failure: the provider did not deliver, release the hold.
  if (result.kind === "failed") return { action: "fail", settle: "release" };
  const age = now.getTime() - (task.submittedAt ?? task.createdAt).getTime();
  // Accepted but never completing: keep the hold, hand over to reconciliation.
  if (age > POLL_MAX_AGE_MS) return { action: "manual" };
  return { action: "reschedule", delayMs: pollDelayMs(task.pollCount + 1) };
}

export const SUBMITTING_STALE_MS = 30 * 60_000;
export type ExpiryDecision =
  | { action: "none" }
  | { action: "release" } // provably never reached the provider
  | { action: "mark_unknown" } // keep hold, reconciliation only
  | { action: "poll" }; // has a receipt: settle by provider result only

/**
 * Hold expiry rule. Only tasks without a provider task id AND with proof that
 * no request left the process (`requestSent === false`) are released.
 * Anything with a task id is settled from the provider's result, never released by time.
 */
export function decideExpiry(
  task: { status: ImageTaskStatus; providerTaskId?: string | null; updatedAt: Date; requestSent: boolean },
  now: Date,
): ExpiryDecision {
  if (isTerminalImageTask(task.status)) return { action: "none" };
  if (task.providerTaskId) return { action: "poll" };
  if (task.status !== "submitting") return { action: "none" };
  if (now.getTime() - task.updatedAt.getTime() < SUBMITTING_STALE_MS) return { action: "none" };
  return task.requestSent ? { action: "mark_unknown" } : { action: "release" };
}

export type LegacyImportRow = {
  id: string;
  requestId: string;
  storyId: number;
  chapterId: number;
  moduleId: string;
  scope: ImageTaskScope;
  sourceHash: string;
  provider: string;
  providerTaskId: string | null;
  status: ImageTaskStatus;
  candidates: { imageId: number; imageUrl: string }[];
  error: string | null;
};

/** Map a legacy stories.body.bookModuleImageTasks entry onto the table shape (read-compat). */
export function legacyBookModuleTaskToRow(storyId: number, task: BookModuleImageTask): LegacyImportRow {
  const providerTaskId = task.providerTaskId?.trim() || null;
  let status: ImageTaskStatus;
  switch (task.status) {
    case "succeeded": status = "succeeded"; break;
    case "failed": status = providerTaskId ? "accepted" : "failed"; break;
    case "accepted": status = providerTaskId ? "accepted" : "submission_unknown"; break;
    // "preparing"/"unknown" without a receipt: we cannot prove nothing was sent.
    default: status = providerTaskId ? "accepted" : "submission_unknown";
  }
  return {
    id: task.id, requestId: task.requestId, storyId, chapterId: task.chapterId, moduleId: task.moduleId,
    scope: "book_module", sourceHash: task.sourceHash, provider: task.provider, providerTaskId, status,
    candidates: Array.isArray(task.candidates) ? task.candidates : [],
    error: task.error ? dedupeAcceptedPrefix(task.error) : null,
  };
}

/** Collapse the duplicated "图片任务已受理，" prefix seen in legacy records. */
export function dedupeAcceptedPrefix(message: string): string {
  return message.replace(/(图片任务已受理[，,]\s*)+/g, "图片任务已受理，");
}
