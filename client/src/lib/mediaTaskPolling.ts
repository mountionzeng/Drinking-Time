/**
 * Background media generation (music / narration). When MEDIA_TASK_ASYNC_SUBMIT is on, the
 * generate mutation returns `{ status: "pending", mediaTaskId }` at once; poll the task until
 * the server-side job (or its 30-minute auto-release sweep) resolves it. Switch off = the
 * mutation result passes straight through, unchanged.
 */
export type MediaTaskStatusView =
  | { state: "pending"; mediaTaskId: string; message: string }
  | { state: "done"; mediaTaskId: string; result: { status: string; message?: string } }
  | { state: "missing"; mediaTaskId: string };

export const MEDIA_TASK_POLL_MS = 3_000;
/** Server auto-releases after 30 min + one worker sweep; stop a little after that. */
export const MEDIA_TASK_POLL_LIMIT_MS = 35 * 60_000;

export function pendingMediaTaskId(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as { status?: unknown; mediaTaskId?: unknown };
  return r.status === "pending" && typeof r.mediaTaskId === "string" ? r.mediaTaskId : null;
}

export async function awaitMediaTask<R>(
  result: R,
  fetchStatus: (mediaTaskId: string) => Promise<MediaTaskStatusView>,
  options: { intervalMs?: number; limitMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number; onPending?: (message: string) => void } = {},
): Promise<R> {
  const id = pendingMediaTaskId(result);
  if (!id) return result;
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const deadline = now() + (options.limitMs ?? MEDIA_TASK_POLL_LIMIT_MS);
  while (now() < deadline) {
    await sleep(options.intervalMs ?? MEDIA_TASK_POLL_MS);
    let view: MediaTaskStatusView;
    try { view = await fetchStatus(id); } catch { continue; } // network blip: keep polling, never resubmit
    if (view.state === "done") {
      const r = view.result;
      // "recovered" = stored by the sweep after the page lost track; caller refreshes its list.
      return (r.status === "recovered" ? { ...r, status: "error", message: r.message ?? "已生成完成，请刷新查看。" } : r) as R;
    }
    if (view.state === "missing") return { status: "error", message: "找不到这次生成任务，请刷新后查看" } as R;
    options.onPending?.(view.message);
  }
  return { status: "pending", message: "仍在后台生成，稍后回来查看（不会重复扣费）" } as R;
}
