import { isLegnextReceipt, resumeLegnextImage } from "./legnextImage";
import { randomUUID } from "node:crypto";
import { bookImageText } from "../../shared/bookImageBlock";
import type { BookModuleImageTask, BookModuleImageTarget, BookModuleImageTaskView } from "../../shared/bookModuleImageTask";
import { getStoryById } from "../repositories/stories";
import { getChapter } from "../repositories/chapters";
import { moduleImageTasks, mutateModuleImageTasks, type ModuleImageOwner } from "../repositories/bookModuleImageTasks";
import { resolveBookModuleSource } from "./bookModuleSource";
import type { ImageGenerationTaskRow } from "../../drizzle/schema";
import { getImageTaskStore } from "../repositories/imageGenerationTasks";
import { completeTask, importLegacyModuleTask, markAccepted, markRejected, markRequestSent, markSubmissionUnknown, pollImageTask, registerImageTask } from "./imageGenerationTaskService";
import { defaultImageTaskDeps, imageTaskAsyncSubmitEnabled } from "./imageGenerationTaskWorker";
import { resume302MidjourneyTask, resume302GptImageTask, type ImageGenCandidate } from "./imageGen";

type Scope = ModuleImageOwner & BookModuleImageTarget;
const matches = (task: BookModuleImageTask, scope: BookModuleImageTarget) => task.chapterId === scope.chapterId && task.moduleId === scope.moduleId;
export async function readModuleImageTask(scope: Scope): Promise<BookModuleImageTaskView | null> {
  const story = await getStoryById(scope.storyId, scope.userId);
  if (!story) throw new Error("故事不存在或无权访问");
  const task = imageTaskAsyncSubmitEnabled()
    ? await readTableModuleTask(scope, story.body)
    : moduleImageTasks(story.body).filter(t => matches(t, scope)).at(-1);
  if (!task) return null;
  const chapter = await getChapter(scope.chapterId, scope.userId);
  const inserted = chapter?.storyId === scope.storyId && task.candidates.some(c => chapter.blocks.body.includes(bookImageText(c.imageUrl)));
  let sourceChanged = true;
  try { sourceChanged = (await resolveBookModuleSource(scope)).fingerprint !== task.sourceHash; } catch { /* Results remain in the warehouse after source removal. */ }
  return { ...task, inserted: Boolean(inserted), sourceChanged };
}
const response = (task: BookModuleImageTask) => {
  const image = task.candidates[0];
  if (task.status === "succeeded" && image) return {
    status: "ok" as const, imageUrl: image.imageUrl, imageId: image.imageId,
    candidates: task.candidates, prompt: "", intent: "", rationale: "", mode: "final" as const,
  };
  return { status: "error" as const,
    error: task.error || "任务已保存，请查看进度或恢复同一任务，不会重新提交生成。",
    ...(task.providerTaskId ? { providerTaskId: task.providerTaskId } : {}),
    submissionUncertain: task.status !== "failed" && !task.providerTaskId,
  };
};

async function accept(scope: Scope, id: string, providerTaskId: string) {
  await mutateModuleImageTasks(scope, tasks => {
    const task = tasks.find(t => t.id === id && matches(t, scope));
    if (!task) throw new Error("任务记录不存在");
    if (task.providerTaskId && task.providerTaskId !== providerTaskId) throw new Error("任务回执不匹配");
    task.providerTaskId = providerTaskId;
    if (task.status !== "succeeded") task.status = "accepted";
  });
}
async function finish(scope: Scope, id: string, candidates: ImageGenCandidate[], meta?: { prompt?: string; promptCompilationId?: number | null }) {
  return mutateModuleImageTasks(scope, async (tasks, store) => {
    const task = tasks.find(t => t.id === id && matches(t, scope));
    if (!task) throw new Error("任务记录不存在");
    if (task.status !== "succeeded") {
      if (!candidates.length || candidates.length > 4) throw new Error("图片候选数量无效");
      task.candidates = await store(candidates.map(c => ({ ...c, ...meta })));
      task.status = "succeeded";
      delete task.error;
    }
    return task.candidates.map(c => ({ id: c.imageId, imageUrl: c.imageUrl }));
  });
}
export type ModuleImageHooks = {
  /** Table mode only: return immediately after the provider accepts; the worker fetches the result. */
  asyncSubmit?: boolean;
  /** Called immediately before the provider request (prompt fully prepared). */
  onPrepared?: (meta: { prompt: string; promptCompilationId?: number | null; promptBillings: PromptBillingEntry[] }) => Promise<void>;
  /** The provider definitely rejected the request with no receipt. */
  onDefiniteFailure?: () => void;
  onMidjourneyTaskAccepted: (id: string) => Promise<void>;
  onProviderTaskAccepted: (id: string) => Promise<void>;
  storeCandidates: (candidates: ImageGenCandidate[], meta: { prompt: string; promptCompilationId?: number | null }) => Promise<{ id: number; imageUrl: string }[]>;
};

/** Claim before prompt preparation. A lost request never grants permission to buy again. */
export async function runModuleImageTask<T extends { status: string; error?: string; providerTaskId?: string; submissionUncertain?: boolean }>(
  scope: Scope & { requestId: string; expectedText: string; provider: "midjourney" | "gpt-image" },
  generate: (hooks: ModuleImageHooks) => Promise<T>,
) {
  if (imageTaskAsyncSubmitEnabled()) return runModuleImageTaskAsync(scope, generate);
  const source = await resolveBookModuleSource(scope);
  if (source.image || source.source !== scope.expectedText) throw new Error("原文字模块已变化，请重新打开生成窗口");
  const previous = await readModuleImageTask(scope);
  const id = randomUUID();
  const claimed = await mutateModuleImageTasks(scope, tasks => {
    const replay = tasks.find(t => matches(t, scope) && t.requestId === scope.requestId);
    if (replay) return replay;
    const existing = tasks.filter(t => matches(t, scope)).at(-1);
    if (existing && existing.status !== "failed" && !(existing.status === "succeeded" && previous?.id === existing.id && previous.inserted)) return existing;
    const task: BookModuleImageTask = { id, requestId: scope.requestId, chapterId: scope.chapterId, moduleId: scope.moduleId, sourceHash: source.fingerprint, provider: scope.provider, status: "preparing", candidates: [] };
    tasks.push(task);
    return task;
  });
  if (claimed.id !== id) return response(claimed);
  let acceptedId: string | undefined;
  let settlementStarted = false;
  const onAccepted = async (taskId: string) => { acceptedId = taskId; await accept(scope, id, taskId); };
  try {
    const result = await generate({ onMidjourneyTaskAccepted: onAccepted, onProviderTaskAccepted: onAccepted,
      storeCandidates: (candidates, meta) => { settlementStarted = true; return finish(scope, id, candidates, meta); } });
    if (result.status !== "ok") await mutateModuleImageTasks(scope, tasks => {
      const task = tasks.find(t => t.id === id)!;
      if (task.status === "succeeded") return;
      task.providerTaskId ||= result.providerTaskId || acceptedId;
      task.status = task.providerTaskId ? "accepted" : result.submissionUncertain || settlementStarted ? "unknown" : "failed";
      task.error = result.error;
    });
    return result;
  } catch (error) {
    // Keep the durable claim even when saving a receipt or final response fails.
    // No lease expiry or browser retry is allowed to turn it into another POST.
    return { status: "error" as const, error: error instanceof Error ? error.message : "任务状态保存失败",
      ...(acceptedId ? { providerTaskId: acceptedId } : {}), submissionUncertain: !acceptedId };
  }
}

export async function recoverModuleImageTask(scope: Scope) {
  if (imageTaskAsyncSubmitEnabled()) return recoverModuleImageTaskAsync(scope);
  const task = await readModuleImageTask(scope);
  if (!task) throw new Error("没有可恢复的模块图片任务");
  if (task.status === "succeeded" || !task.providerTaskId) return response(task);
  // Never compile a new prompt, submit a new task, or change the saved provider.
  const result = isLegnextReceipt(task.providerTaskId)
    ? await resumeLegnextImage(task.providerTaskId)
    : task.provider === "midjourney"
    ? await resume302MidjourneyTask(task.providerTaskId, { mjTimeoutMs: 8_000, mjPollIntervalMs: 1_000 })
    : await resume302GptImageTask(task.providerTaskId, { gptImageModel: "gpt-image-2", gptTimeoutMs: 8_000, gptPollIntervalMs: 1_000 });
  if (result.status === "ok") {
    await finish(scope, task.id, result.candidates ?? (result.imageUrl ? [{ imageUrl: result.imageUrl, imageKey: result.imageKey }] : []));
    return response((await readModuleImageTask(scope))!);
  }
  // Transient fetch errors must never clear the previously accepted receipt.
  return { status: "error" as const, error: result.message ?? "任务尚未完成，请稍后恢复", providerTaskId: task.providerTaskId };
}

// ---------------------------------------------------------------------------
// Table mode (IMAGE_TASK_ASYNC_SUBMIT=1 && IMAGE_TASK_WORKER_ENABLED=1).
// Tasks live in image_generation_tasks; stories.body is never written. Legacy body
// records are read as a fallback and copied into the table (the body copy stays).
// ---------------------------------------------------------------------------
type PromptBillingEntry = { operationId: string; chargeMinor: number };
const STILL_RUNNING = "图片仍在生成中，后台会自动取回并保存到仓库，请稍后查看，不会重复购买。";

export function rowToModuleTask(row: ImageGenerationTaskRow): BookModuleImageTask {
  const status: BookModuleImageTask["status"] = row.status === "submitting" ? "preparing"
    : row.status === "submission_unknown" ? "unknown"
    : row.status === "accepted" ? "accepted" : row.status === "succeeded" ? "succeeded" : "failed";
  return {
    id: row.id, requestId: row.requestId, chapterId: row.chapterId ?? 0, moduleId: row.moduleId ?? "",
    sourceHash: row.sourceHash ?? "", provider: row.provider === "gpt-image" ? "gpt-image" : "midjourney", status,
    ...(row.providerTaskId ? { providerTaskId: row.providerTaskId } : {}),
    ...(row.error ? { error: row.error } : row.status === "accepted" ? { error: STILL_RUNNING } : {}),
    candidates: Array.isArray(row.candidates) ? row.candidates : [],
  };
}

async function readTableModuleTask(scope: Scope, body: unknown) {
  const store = await getImageTaskStore();
  let rows = await store.listForModule(scope.userId, scope.storyId, scope.chapterId, scope.moduleId);
  if (!rows.length) {
    const legacy = moduleImageTasks(body).filter(t => matches(t, scope)).at(-1);
    if (!legacy) return undefined;
    await importLegacyModuleTask(store, scope.userId, scope.storyId, legacy);
    rows = await store.listForModule(scope.userId, scope.storyId, scope.chapterId, scope.moduleId);
  }
  const row = rows.at(-1);
  return row ? rowToModuleTask(row) : undefined;
}

export async function runModuleImageTaskAsync<T extends { status: string; error?: string; providerTaskId?: string; submissionUncertain?: boolean }>(
  scope: Scope & { requestId: string; expectedText: string; provider: "midjourney" | "gpt-image" },
  generate: (hooks: ModuleImageHooks) => Promise<T>,
): Promise<T | ReturnType<typeof response>> {
  const source = await resolveBookModuleSource(scope);
  if (source.image || source.source !== scope.expectedText) throw new Error("原文字模块已变化，请重新打开生成窗口");
  const previous = await readModuleImageTask(scope);
  if (previous && previous.requestId !== scope.requestId && previous.status !== "failed" && !(previous.status === "succeeded" && previous.inserted)) {
    return response(previous);
  }
  const deps = await defaultImageTaskDeps();
  const { row: claimed, replayed } = await registerImageTask(deps.store, {
    userId: scope.userId, requestId: scope.requestId, scope: "book_module", provider: scope.provider,
    storyId: scope.storyId, chapterId: scope.chapterId, moduleId: scope.moduleId, sourceHash: source.fingerprint,
  });
  if (replayed) return response(rowToModuleTask(claimed));
  const id = claimed.id;
  let acceptedId: string | undefined, requestSent = false, definite = false, completing = false;
  const onAccepted = async (taskId: string) => { acceptedId = taskId; await markAccepted(deps.store, id, taskId); };
  try {
    const result = await generate({
      asyncSubmit: true,
      onPrepared: async meta => {
        await markRequestSent(deps.store, id, new Date(), { prompt: meta.prompt, promptCompilationId: meta.promptCompilationId ?? null, promptBillings: meta.promptBillings });
        requestSent = true;
      },
      onDefiniteFailure: () => { definite = true; },
      onMidjourneyTaskAccepted: onAccepted, onProviderTaskAccepted: onAccepted,
      storeCandidates: async candidates => {
        completing = true;
        const done = await completeTask(deps, id, candidates);
        const row = done ?? await deps.store.get(id);
        if (!row || row.status !== "succeeded") throw new Error("任务状态已变化，图片未重复入库");
        return row.candidates.map(c => ({ id: c.imageId, imageUrl: c.imageUrl }));
      },
    });
    if (result.status === "ok") return result;
    const receipt = result.providerTaskId || acceptedId;
    // Backward-compatible shape: existing clients already treat error+providerTaskId as an
    // accepted task (never retry). `pending`/`imageTaskId` let new clients poll instead.
    if (receipt) return { ...result, status: "error", error: STILL_RUNNING, providerTaskId: receipt, pending: true, imageTaskId: id, submissionUncertain: false } as T;
    if (completing) return result; // images may be stored; never mark failed here
    if (!requestSent || (definite && !result.submissionUncertain)) await markRejected(deps, id, result.error ?? "图片生成失败");
    else await markSubmissionUnknown(deps, id, result.error ?? "图片提交结果未知，不会重新提交。");
    return result;
  } catch (error) {
    // Row stays; the expiry rule decides (requestSentAt null → release, else unknown). Never resubmit.
    return { status: "error" as const, error: error instanceof Error ? error.message : "任务状态保存失败",
      ...(acceptedId ? { providerTaskId: acceptedId } : {}), submissionUncertain: !acceptedId } as unknown as T;
  }
}

export async function recoverModuleImageTaskAsync(scope: Scope) {
  const view = await readModuleImageTask(scope);
  if (!view) throw new Error("没有可恢复的模块图片任务");
  if (view.status !== "accepted" || !view.providerTaskId) return response(view);
  const deps = await defaultImageTaskDeps();
  const owner = `user-${randomUUID().slice(0, 8)}`;
  const now = new Date();
  if (await deps.store.claim(view.id, owner, now, new Date(now.getTime() + 60_000))) {
    try {
      const row = await deps.store.get(view.id);
      if (row?.status === "accepted") await pollImageTask(deps, row); // query only, never a new POST
    } finally { await deps.store.releaseLease(view.id, owner); }
  }
  return response((await readModuleImageTask(scope))!);
}
