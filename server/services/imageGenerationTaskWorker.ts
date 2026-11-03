import { randomUUID } from "node:crypto";
import { getImageTaskStore } from "../repositories/imageGenerationTasks";
import { createGeneratedImage } from "../repositories/images";
import { isLegnextReceipt, resumeLegnextImage } from "./legnextImage";
import { resume302GptImageTask, resume302MidjourneyTask } from "./imageGen";
import { settleOperation } from "./computeLedger";
import { settleMediaQuote } from "./mediaComputeBilling";
import { sweepImageTasks, type ImageTaskDeps } from "./imageGenerationTaskService";

/** Off by default. Step 1 ships the worker dark; enable only after step 2 wires the routes. */
export function imageTaskWorkerEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.IMAGE_TASK_WORKER_ENABLED === "1";
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
    storeCandidates: async (task, candidates) => {
      const out = [];
      for (const c of candidates) {
        const img = await createGeneratedImage({
          userId: task.userId, storyId: task.storyId, imageUrl: c.imageUrl, imageKey: c.imageKey ?? null,
          prompt: "", isCurrent: false,
        });
        out.push({ imageId: img.id, imageUrl: img.imageUrl });
      }
      return out;
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
