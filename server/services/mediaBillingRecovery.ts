import { listUnsettledMediaOperations } from "../repositories/computeLedger";
import { getVideoTakeById, updateVideoTake } from "../repositories/videos";
import {
  readMediaResult,
  settleMediaQuote,
  finishVideoBilling,
  mediaBillingEnabled,
} from "./mediaComputeBilling";
import { settleOperation } from "./computeLedger";
import { refreshShotVideoTask } from "./videoGen";
import { refreshViduTransition } from "./videoTransition302";

/** Recovery only queries existing task IDs. It must never generate or upload. */
export async function reconcileMediaBilling(afterId = 0): Promise<number> {
  const operations = await listUnsettledMediaOperations(afterId);
  for (const operation of operations) {
    try {
      const receipt = await readMediaResult(operation.operationId);
      if (
        typeof receipt?.audioUrl === "string" ||
        typeof receipt?.videoUrl === "string"
      ) {
        await settleMediaQuote(operation.operationId);
        continue;
      }
      if (
        typeof receipt?.taskId !== "string" ||
        typeof receipt?.takeId !== "number"
      ) {
        // A lost response has no safe provider retry. Keep the hold for reconciliation.
        if (Date.now() - new Date(operation.createdAt).getTime() > 5 * 60_000) {
          await settleOperation({
            operationId: operation.operationId,
            outcome: { kind: "submission_unknown" },
          });
        }
        continue;
      }
      const take = await getVideoTakeById(receipt.takeId, operation.userId);
      if (!take || take.storyId !== operation.storyId) continue;
      const snapshot = take.parameterSnapshot as Record<string, unknown> | null;
      if (snapshot?.computeOperationId !== operation.operationId) continue;
      if (!take.taskId) {
        await updateVideoTake(take.id, take.userId, {
          taskId: receipt.taskId,
          status: "processing",
        });
      }
      const refreshed =
        snapshot.kind === "shot-start-end"
          ? await refreshViduTransition(receipt.taskId)
          : await refreshShotVideoTask(receipt.taskId);
      if (refreshed.status === "available") {
        await finishVideoBilling(take, { videoUrl: refreshed.videoUrl });
      } else if (
        refreshed.status !== "processing" &&
        refreshed.status !== "retryable"
      ) {
        await finishVideoBilling(take, { unknown: true });
      }
    } catch (error) {
      console.warn(
        "[media-billing] recovery pending",
        operation.operationId,
        error instanceof Error ? error.message : "unknown error"
      );
    }
  }
  return operations.length === 25 ? operations[operations.length - 1].id : 0;
}

export function startMediaBillingRecovery(): () => void {
  if (!mediaBillingEnabled()) return () => {};
  let running = false;
  let cursor = 0;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void reconcileMediaBilling(cursor)
      .then(next => {
        cursor = next;
      })
      .catch(error =>
        console.warn("[media-billing] recovery unavailable", error)
      )
      .finally(() => {
        running = false;
      });
  }, 15_000);
  timer.unref();
  return () => clearInterval(timer);
}
