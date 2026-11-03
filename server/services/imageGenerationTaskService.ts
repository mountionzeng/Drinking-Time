import { randomUUID } from "node:crypto";
import type { ImageGenerationTaskRow } from "../../drizzle/schema";
import {
  canTransition, decideExpiry, decidePoll, dedupeAcceptedPrefix, legacyBookModuleTaskToRow,
  SUBMITTING_STALE_MS, type ImageTaskScope, type ImageTaskStatus, type UpstreamPollResult,
} from "../../shared/imageGenerationTask";
import type { BookModuleImageTask } from "../../shared/bookModuleImageTask";
import type { ImageTaskPatch, ImageTaskStore } from "../repositories/imageGenerationTasks";
import type { ImageGenCandidate, ImageGenResult } from "./imageGen";

export type SettleOutcome = { kind: "succeeded_at_quote" } | { kind: "not_charged_failure" } | { kind: "submission_unknown" };
export type ImageTaskDeps = {
  store: ImageTaskStore;
  /** Query only. Must never POST a new generation. */
  resume: (task: ImageGenerationTaskRow) => Promise<ImageGenResult>;
  /** Persist provider images into generated_images; returns warehouse rows. */
  storeCandidates: (task: ImageGenerationTaskRow, candidates: ImageGenCandidate[]) => Promise<{ imageId: number; imageUrl: string }[]>;
  /** Ledger settlement; idempotent per operationId (terminal statuses are noop). */
  settle: (operationId: string, outcome: SettleOutcome) => Promise<void>;
  now?: () => Date;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
};

const nowOf = (deps: Pick<ImageTaskDeps, "now">) => (deps.now ?? (() => new Date()))();

export type RegisterInput = {
  userId: number; requestId: string; scope: ImageTaskScope; provider: string; model?: string | null;
  storyId?: number | null; chapterId?: number | null; moduleId?: string | null; sourceHash?: string | null;
  billingOperationId?: string | null;
};

/** Durable claim before any provider call. Replays of the same requestId return the existing row. */
export async function registerImageTask(store: ImageTaskStore, input: RegisterInput, now = new Date()) {
  const row: ImageGenerationTaskRow = {
    id: randomUUID(), userId: input.userId, storyId: input.storyId ?? null, chapterId: input.chapterId ?? null,
    moduleId: input.moduleId ?? null, scope: input.scope, requestId: input.requestId, sourceHash: input.sourceHash ?? null,
    provider: input.provider, model: input.model ?? null, providerTaskId: null, status: "submitting", candidates: [],
    error: null, billingOperationId: input.billingOperationId ?? null, settlement: null, version: 0, pollCount: 0,
    nextPollAt: null, leaseOwner: null, leaseUntil: null, requestSentAt: null, submittedAt: null, completedAt: null,
    createdAt: now, updatedAt: now,
  };
  return store.insert(row);
}

async function transition(store: ImageTaskStore, row: ImageGenerationTaskRow, to: ImageTaskStatus, patch: ImageTaskPatch, now: Date) {
  const from = row.status as ImageTaskStatus;
  if (from !== to && !canTransition(from, to)) throw new Error(`非法的出图任务状态流转 ${from} → ${to}`);
  return store.update(row.id, { version: row.version, status: from }, { ...patch, status: to }, now);
}

/** Call immediately before the provider POST. After this, failure without receipt = submission_unknown. */
export async function markRequestSent(store: ImageTaskStore, id: string, now = new Date()) {
  const row = await store.get(id);
  if (!row || row.status !== "submitting" || row.requestSentAt) throw new Error("出图任务不可提交（已提交过或状态已变化）");
  const next = await transition(store, row, "submitting", { requestSentAt: now }, now);
  if (!next) throw new Error("出图任务已被其他请求占用");
  return next;
}

export async function markAccepted(store: ImageTaskStore, id: string, providerTaskId: string, now = new Date()) {
  const row = await store.get(id);
  if (!row) throw new Error("出图任务不存在");
  if (row.providerTaskId) {
    if (row.providerTaskId !== providerTaskId) throw new Error("任务回执不匹配");
    return row;
  }
  return transition(store, row, "accepted", { providerTaskId, submittedAt: now, nextPollAt: now }, now);
}

/** Provider answered with a definite rejection and no receipt. */
export async function markRejected(deps: ImageTaskDeps, id: string, message: string) {
  const now = nowOf(deps);
  const row = await deps.store.get(id);
  if (!row || row.providerTaskId) return row; // never fail a task that has a receipt
  const next = await transition(deps.store, row, "failed", { error: message, completedAt: now }, now);
  if (next) await settleTask(deps, next);
  return next;
}

/** Request left the process, no receipt came back. Keep the hold; never resubmit. */
export async function markSubmissionUnknown(deps: ImageTaskDeps, id: string, message: string) {
  const now = nowOf(deps);
  const row = await deps.store.get(id);
  if (!row || row.providerTaskId || row.status !== "submitting") return row;
  const next = await transition(deps.store, row, "submission_unknown", { error: message }, now);
  if (next?.billingOperationId) await deps.settle(next.billingOperationId, { kind: "submission_unknown" });
  return next;
}

/** Final ledger step, once per task: `settlement` CAS + ledger terminal-status idempotency. */
export async function settleTask(deps: ImageTaskDeps, row: ImageGenerationTaskRow) {
  if (!row.billingOperationId || row.settlement) return row;
  const status = row.status as ImageTaskStatus;
  if (status !== "succeeded" && status !== "failed") return row;
  const settlement = status === "succeeded" ? "charged" : "released";
  await deps.settle(row.billingOperationId, status === "succeeded" ? { kind: "succeeded_at_quote" } : { kind: "not_charged_failure" });
  return (await deps.store.update(row.id, { version: row.version, status }, { settlement }, nowOf(deps))) ?? row;
}

function toPollResult(result: ImageGenResult): UpstreamPollResult {
  if (result.status === "ok") {
    const n = result.candidates?.length ?? (result.imageUrl ? 1 : 0);
    return { kind: "completed", candidateCount: n };
  }
  if (result.message?.includes("供应商确认")) return { kind: "failed" };
  return { kind: "pending" };
}

/** Process one accepted task: query provider, store images, settle. Caller holds the lease. */
export async function pollImageTask(deps: ImageTaskDeps, row: ImageGenerationTaskRow) {
  const now = nowOf(deps);
  let result: ImageGenResult;
  try { result = await deps.resume(row); } catch { result = { status: "error", message: "暂时无法查询任务" }; }
  const decision = decidePoll({ ...row, status: row.status as ImageTaskStatus }, toPollResult(result), now);
  if (decision.action === "reschedule") {
    return deps.store.update(row.id, { version: row.version, status: row.status as ImageTaskStatus },
      { pollCount: row.pollCount + 1, nextPollAt: new Date(now.getTime() + decision.delayMs) }, now);
  }
  if (decision.action === "manual") {
    deps.log?.("[image-task] accepted task exceeded poll window; kept hold for reconciliation", { id: row.id });
    return deps.store.update(row.id, { version: row.version, status: row.status as ImageTaskStatus },
      { pollCount: row.pollCount + 1, nextPollAt: new Date(now.getTime() + 60 * 60_000) }, now);
  }
  if (decision.action === "fail") {
    const next = await transition(deps.store, row, "failed", { error: dedupeAcceptedPrefix(result.message ?? "供应商确认生成失败"), completedAt: now }, now);
    return next ? settleTask(deps, next) : null;
  }
  const raw = result.candidates ?? (result.imageUrl ? [{ imageUrl: result.imageUrl, imageKey: result.imageKey }] : []);
  const stored = await deps.storeCandidates(row, raw.slice(0, 4) as ImageGenCandidate[]);
  const next = await transition(deps.store, row, "succeeded", { candidates: stored, error: null, completedAt: now }, now);
  return next ? settleTask(deps, next) : null;
}

/** Handle a stale `submitting` row by the expiry rule. Never resubmits. */
export async function expireSubmittingTask(deps: ImageTaskDeps, row: ImageGenerationTaskRow) {
  const decision = decideExpiry({ status: row.status as ImageTaskStatus, providerTaskId: row.providerTaskId, updatedAt: row.updatedAt, requestSent: !!row.requestSentAt }, nowOf(deps));
  if (decision.action === "release") return markRejected(deps, row.id, "任务未提交到供应商即中断，已退回预占。");
  if (decision.action === "mark_unknown") return markSubmissionUnknown(deps, row.id, "提交结果未知，已保留预占待对账，不会重新提交。");
  return row;
}

/** One sweep. Each row is leased first so concurrent workers/instances process it once. */
export async function sweepImageTasks(deps: ImageTaskDeps, owner: string, limit = 20) {
  const now = nowOf(deps);
  const due = await deps.store.listDue(now, new Date(now.getTime() - SUBMITTING_STALE_MS), limit);
  let processed = 0;
  for (const candidate of due) {
    if (!await deps.store.claim(candidate.id, owner, now, new Date(now.getTime() + 120_000))) continue;
    try {
      const row = await deps.store.get(candidate.id);
      if (!row) continue;
      if (row.status === "accepted") await pollImageTask(deps, row);
      else if (row.status === "submitting") await expireSubmittingTask(deps, row);
      else await settleTask(deps, row);
      processed++;
    } catch (error) {
      deps.log?.("[image-task] sweep item failed", { id: candidate.id, error: error instanceof Error ? error.message : "unknown" });
    } finally {
      await deps.store.releaseLease(candidate.id, owner);
    }
  }
  return processed;
}

/** Read-compat: find a task in the table first, then fall back to the legacy story-body record. */
export function pickTaskForModule(
  tableRows: ImageGenerationTaskRow[], legacy: BookModuleImageTask[], storyId: number,
  target: { chapterId: number; moduleId: string },
) {
  const fromTable = tableRows.filter(r => r.storyId === storyId && r.chapterId === target.chapterId && r.moduleId === target.moduleId)
    .sort((a, b) => +a.createdAt - +b.createdAt).at(-1);
  if (fromTable) return { source: "table" as const, row: fromTable };
  const old = legacy.filter(t => t.chapterId === target.chapterId && t.moduleId === target.moduleId).at(-1);
  return old ? { source: "legacy" as const, row: legacyBookModuleTaskToRow(storyId, old) } : null;
}
