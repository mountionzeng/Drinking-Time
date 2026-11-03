import type { ImageGenerationTaskRow } from "../../drizzle/schema";
import {
  decideStaleSyncMedia, isSyncMediaKind, parseVideoTaskRef, SYNC_MEDIA_AUTO_RELEASE_MS,
  VIDEO_TASK_POLL_WINDOW_MS, type SyncMediaKind,
} from "../../shared/mediaTask";
import { pollDelayMs, type ImageTaskStatus } from "../../shared/imageGenerationTask";
import type { ImageTaskStore } from "../repositories/imageGenerationTasks";

type Log = (msg: string, extra?: Record<string, unknown>) => void;
const cas = (row: ImageGenerationTaskRow) => ({ version: row.version, status: row.status as ImageTaskStatus });

// ── Video: provider task id exists; poll the take through the existing refresh path ──────────

export type VideoHandlerDeps = {
  store: ImageTaskStore;
  /** Existing refreshVideoTakeStatus: query only, downloads into video_takes and settles the hold. */
  refreshTake: (takeId: number, userId: number) => Promise<{ status: "ok"; take: { status: string; errorMessage?: string | null } } | { status: "error"; error: string }>;
  now?: () => Date;
  log?: Log;
};

const VIDEO_DONE = new Set(["available", "unfollowable", "failed", "timeout", "cancelled", "discarded"]);

export async function handleVideoTask(deps: VideoHandlerDeps, row: ImageGenerationTaskRow) {
  const now = (deps.now ?? (() => new Date()))();
  if (row.status !== "accepted") return row;
  const takeId = parseVideoTaskRef(row.targetRef);
  if (!takeId) return deps.store.update(row.id, cas(row), { status: "failed", error: "视频任务缺少 take 引用", completedAt: now }, now);
  let result: Awaited<ReturnType<VideoHandlerDeps["refreshTake"]>>;
  try { result = await deps.refreshTake(takeId, row.userId); }
  catch (error) { result = { status: "error", error: error instanceof Error ? error.message : "查询失败" }; }
  if (result.status === "ok" && VIDEO_DONE.has(result.take.status)) {
    const ok = result.take.status === "available";
    return deps.store.update(row.id, cas(row), {
      status: ok ? "succeeded" : "failed", error: ok ? null : result.take.errorMessage ?? result.take.status, completedAt: now,
    }, now);
  }
  // Still generating (or our query failed). Never mark unknown on time: billing stays with the take.
  const age = now.getTime() - (row.submittedAt ?? row.createdAt).getTime();
  const manual = age > VIDEO_TASK_POLL_WINDOW_MS;
  if (manual) deps.log?.("[video-task] exceeded poll window; hold kept for reconciliation", { id: row.id, takeId });
  return deps.store.update(row.id, cas(row), {
    pollCount: row.pollCount + 1,
    nextPollAt: new Date(now.getTime() + (manual ? 60 * 60_000 : pollDelayMs(row.pollCount + 1))),
  }, now);
}

// ── Sync media (music / narration / tts): no provider task id, the call runs in-process ─────

export type SyncMediaResult = { status: string; message?: string; [k: string]: unknown };

export type SyncHandlerDeps = {
  store: ImageTaskStore;
  /** Evidence for an operation; all reads, nothing is generated. */
  evidence: (row: ImageGenerationTaskRow) => Promise<{ assetId: number | null; providerOutputRecorded: boolean; ledgerStatus: string | null }>;
  chargeAtQuote: (operationId: string) => Promise<void>;
  release: (operationId: string, reason: string) => Promise<void>;
  freeze: (operationId: string, reason: string) => Promise<void>;
  now?: () => Date;
  log?: Log;
};

const LEDGER_FINAL = new Set(["settled", "released", "exception"]);
export const AUTO_RELEASE_MESSAGE = "生成超过 30 分钟仍未确认结果，已自动退回预占的算力，可重新发起。";

/** Stale sync media row (>30 min, job crashed or result unknown). Refund only without proof of output. */
export async function handleStaleSyncMediaTask(deps: SyncHandlerDeps, row: ImageGenerationTaskRow) {
  const now = (deps.now ?? (() => new Date()))();
  if (row.status !== "submitting") return row;
  if (now.getTime() - row.updatedAt.getTime() < SYNC_MEDIA_AUTO_RELEASE_MS) return row;
  const operationId = row.targetRef;
  if (!operationId) return deps.store.update(row.id, cas(row), { status: "failed", error: "缺少计费操作号", completedAt: now }, now);
  const ev = await deps.evidence(row);
  const decision = decideStaleSyncMedia({
    assetStored: ev.assetId != null, providerOutputRecorded: ev.providerOutputRecorded,
    ledgerFinal: ev.ledgerStatus == null || LEDGER_FINAL.has(ev.ledgerStatus),
  });
  deps.log?.("[media-task] stale sync media resolved", { id: row.id, kind: row.mediaKind, operationId, decision: decision.action, ledgerStatus: ev.ledgerStatus });
  if (decision.action === "succeed") {
    if (decision.charge) await deps.chargeAtQuote(operationId); // stored successfully: never refund
    return deps.store.update(row.id, cas(row), {
      status: "succeeded", settlement: "charged", completedAt: now, error: null,
      resultPayload: { status: "recovered", assetId: ev.assetId, message: "已生成完成，请刷新查看。" },
    }, now);
  }
  if (decision.action === "manual") {
    const reason = "供应商已返回音频但未完成入库，已保留预占待对账，不会自动重试。";
    await deps.freeze(operationId, reason);
    return deps.store.update(row.id, cas(row), {
      status: "submission_unknown", settlement: "manual", error: reason,
      resultPayload: { status: "submission-unknown", message: reason },
    }, now);
  }
  if (decision.action === "release") {
    await deps.release(operationId, AUTO_RELEASE_MESSAGE); // ledger release is idempotent per operationId
    return deps.store.update(row.id, cas(row), {
      status: "failed", settlement: "released", completedAt: now, error: AUTO_RELEASE_MESSAGE,
      resultPayload: { status: "error", message: AUTO_RELEASE_MESSAGE },
    }, now);
  }
  const message = row.error ?? "这次生成已经结束，请重新发起";
  return deps.store.update(row.id, cas(row), {
    status: "failed", completedAt: now, error: message, resultPayload: { status: "error", message },
  }, now);
}

/** Map the original route result onto the task row (called when the background call returns). */
export async function finishSyncMediaTask(store: ImageTaskStore, id: string, result: SyncMediaResult, now = new Date(), log?: Log) {
  const row = await store.get(id);
  if (!row || row.status !== "submitting") return row; // already resolved (e.g. by the stale sweep)
  const ready = result.status === "ready" || result.status === "candidate-ready";
  if (ready) return store.update(row.id, cas(row), { status: "succeeded", settlement: "charged", completedAt: now, error: null, resultPayload: result }, now);
  if (result.status === "error") return store.update(row.id, cas(row), { status: "failed", completedAt: now, error: result.message ?? "生成失败", resultPayload: result }, now);
  // submission-unknown / pending: keep `submitting`; the 30-minute sweep decides (refund unless proven).
  log?.("[media-task] result unknown; auto-release in 30 min unless output is proven", { id, kind: row.mediaKind, status: result.status, message: result.message });
  return store.update(row.id, cas(row), { error: result.message ?? result.status }, now);
}

export type MediaTaskView =
  | { state: "pending"; mediaTaskId: string; message: string }
  | { state: "done"; mediaTaskId: string; result: SyncMediaResult };

export function mediaTaskView(row: ImageGenerationTaskRow): MediaTaskView {
  if (row.status === "submitting" || row.status === "accepted")
    return { state: "pending", mediaTaskId: row.id, message: "正在后台生成，可以离开页面，稍后回来查看" };
  const payload = row.resultPayload as SyncMediaResult | null;
  return { state: "done", mediaTaskId: row.id, result: payload ?? { status: row.status === "succeeded" ? "recovered" : "error", message: row.error ?? undefined } };
}

export const isSyncMediaRow = (row: ImageGenerationTaskRow): row is ImageGenerationTaskRow & { mediaKind: SyncMediaKind } => isSyncMediaKind(row.mediaKind);
