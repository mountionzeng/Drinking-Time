import { randomUUID } from "node:crypto";
import { getImageTaskStore } from "../repositories/imageGenerationTasks";
import { isLegnextReceipt, resumeLegnextImage } from "./legnextImage";
import { resume302GptImageTask, resume302MidjourneyTask } from "./imageGen";
import { settleOperation } from "./computeLedger";
import { settleMediaQuote } from "./mediaComputeBilling";
import { markAccepted, markRequestSent, registerImageTask, sweepImageTasks, type ImageTaskDeps } from "./imageGenerationTaskService";

/** Off by default. Step 1 ships the worker dark; enable only after step 2 wires the routes. */
export function imageTaskWorkerEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.IMAGE_TASK_WORKER_ENABLED === "1";
}

/**
 * "Submit then return": routes register an image_generation_tasks row and return
 * `pending` right after the provider accepts. Requires the worker (nothing else
 * would fetch the result), so it is effective only when BOTH switches are "1".
 * Off = the original synchronous behaviour, byte for byte.
 */
export function imageTaskAsyncSubmitEnabled(env: NodeJS.ProcessEnv = process.env) {
  return imageTaskWorkerEnabled(env) && env.IMAGE_TASK_ASYNC_SUBMIT === "1";
}

export async function defaultImageTaskDeps(): Promise<ImageTaskDeps> {
  return {
    store: await getImageTaskStore(),
    // Query-only resume paths; none of them can create a new provider job.
    resume: async task => {
      const id = task.providerTaskId!;
      if (isLegnextReceipt(id)) return resumeLegnextImage(id);
      return task.provider === "midjourney"
        ? resume302MidjourneyTask(id, { mjTimeoutMs: 8_000, mjPollIntervalMs: 1_000 })
        : resume302GptImageTask(id, { gptImageModel: "gpt-image-2", gptTimeoutMs: 8_000, gptPollIntervalMs: 1_000 });
    },
    refundPrompt: async (task, reason) => {
      const { refundImagePromptCharges } = await import("./imagePromptRefund");
      await refundImagePromptCharges({ userId: task.userId, billings: task.promptBillings ?? [], reason });
    },
    settle: async (operationId, outcome) => {
      if (outcome.kind === "succeeded_at_quote") await settleMediaQuote(operationId);
      else await settleOperation({ operationId, outcome });
    },
    log: (msg, extra) => console.warn(msg, extra ?? {}),
  };
}

export function startImageTaskWorker(intervalMs = 15_000): () => void {
  if (!imageTaskWorkerEnabled()) return () => {};
  const owner = `${process.pid}-${randomUUID().slice(0, 8)}`;
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void defaultImageTaskDeps()
      .then(deps => sweepImageTasks(deps, owner))
      .catch(error => console.warn("[image-task] worker unavailable", error instanceof Error ? error.message : error))
      .finally(() => { running = false; });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Record an already-accepted provider receipt (sync route that ran out of inline polling)
 * so the worker fetches it. requestId is derived from the receipt: replays are no-ops.
 */
export async function registerAcceptedImageTask(input: {
  userId: number; storyId: number; provider: string; model?: string | null; providerTaskId: string;
  prompt: string; promptCompilationId?: number | null; promptBillings?: { operationId: string; chargeMinor: number }[];
}) {
  const store = await getImageTaskStore();
  const { row, replayed } = await registerImageTask(store, {
    userId: input.userId, storyId: input.storyId, requestId: `receipt:${input.providerTaskId}`.slice(0, 128), scope: "mobile",
    provider: input.provider, model: input.model ?? null,
  });
  if (replayed) return row;
  await markRequestSent(store, row.id, new Date(), { prompt: input.prompt, promptCompilationId: input.promptCompilationId ?? null, promptBillings: input.promptBillings ?? [] });
  return (await markAccepted(store, row.id, input.providerTaskId)) ?? row;
}
