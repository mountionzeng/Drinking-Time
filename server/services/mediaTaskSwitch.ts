import { getImageTaskStore } from "../repositories/imageGenerationTasks";
import { videoTaskRef, type SyncMediaKind } from "../../shared/mediaTask";
import { imageTaskWorkerEnabled } from "./imageGenerationTaskWorker";
import { markAccepted, markRequestSent, registerImageTask } from "./imageGenerationTaskService";
import { finishSyncMediaTask, mediaTaskView, type SyncMediaResult } from "./mediaTaskHandlers";

/**
 * Background media generation (video / music / narration / tts). Off by default = original
 * behaviour. Needs the shared task worker (IMAGE_TASK_WORKER_ENABLED=1): nothing else would
 * fetch results or auto-release stale holds.
 */
export function mediaTaskAsyncSubmitEnabled(env: NodeJS.ProcessEnv = process.env) {
  return imageTaskWorkerEnabled(env) && env.MEDIA_TASK_ASYNC_SUBMIT === "1";
}

/** Video already has a provider task id: record it so the worker polls the take. Replay-safe. */
export async function registerVideoMediaTask(input: { userId: number; storyId: number; takeId: number; providerTaskId: string }) {
  const store = await getImageTaskStore();
  const { row, replayed } = await registerImageTask(store, {
    userId: input.userId, storyId: input.storyId, requestId: videoTaskRef(input.takeId), scope: "mobile",
    provider: "302-video", mediaKind: "video", targetRef: videoTaskRef(input.takeId),
  });
  if (replayed) return row;
  await markRequestSent(store, row.id);
  // Namespaced so a video id can never collide with an image receipt in the unique index.
  return (await markAccepted(store, row.id, `video:${input.providerTaskId}`)) ?? row;
}

/** Sync media: claim a row before the background call. requestId = operationId (replay returns same row). */
export async function registerSyncMediaTask(input: { userId: number; storyId: number; kind: SyncMediaKind; operationId: string }) {
  const store = await getImageTaskStore();
  const { row, replayed } = await registerImageTask(store, {
    userId: input.userId, storyId: input.storyId, requestId: `${input.kind}:${input.operationId}`.slice(0, 128),
    scope: "mobile", provider: "302-audio", mediaKind: input.kind, targetRef: input.operationId,
  });
  return { row, replayed, store };
}

/**
 * Run the original (synchronous upstream) generation in the background and return at once.
 * `run` is the unchanged route function with the same operationId, so a replay or a client
 * retry hits its existing reservation/attempt idempotency and never charges twice.
 */
export async function runSyncMediaInBackground<R extends SyncMediaResult>(input: {
  userId: number; storyId: number; kind: SyncMediaKind; operationId: string; run: () => Promise<R>;
}): Promise<{ status: "pending"; message: string; mediaTaskId: string } | R> {
  const { row, replayed, store } = await registerSyncMediaTask(input);
  if (replayed) {
    const view = mediaTaskView(row);
    if (view.state === "done") return view.result as R;
    return { status: "pending", message: view.message, mediaTaskId: row.id };
  }
  const sent = await markRequestSent(store, row.id);
  void input.run()
    .catch(error => {
      // The route functions settle their own ledger; an escaped throw is "unknown" until the sweep decides.
      console.warn("[media-task] background generation threw", { id: row.id, kind: input.kind, error: error instanceof Error ? error.message : "unknown" });
      return { status: "submission-unknown", message: "后台生成异常中断，结果未确认" } as SyncMediaResult;
    })
    .then(result => finishSyncMediaTask(store, sent.id, result, new Date(), (m, e) => console.warn(m, e ?? {})))
    .catch(error => console.warn("[media-task] could not record result", { id: row.id, error: error instanceof Error ? error.message : "unknown" }));
  return { status: "pending", message: "正在后台生成，可以离开页面，稍后回来查看", mediaTaskId: row.id };
}

export async function getMediaTaskStatus(userId: number, mediaTaskId: string) {
  const store = await getImageTaskStore();
  const row = await store.get(mediaTaskId);
  if (!row || row.userId !== userId || row.mediaKind === "image") return null;
  return mediaTaskView(row);
}
