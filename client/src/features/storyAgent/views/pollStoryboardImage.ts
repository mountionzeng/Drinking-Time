import { IMAGE_TASK_POLL_MS, IMAGE_TASK_POLL_LIMIT_MS } from "@/lib/imageTaskPolling";

type RecoveryResult = { status: "ok" } | { status: "error"; recoveryPending?: boolean };

/** Follow only the supplied recovery request. Never submit, and never overlap queries. */
export function pollStoryboardImage<T extends RecoveryResult>(
  query: () => Promise<T>,
  signal: AbortSignal,
): Promise<T | { status: "cancelled" | "timeout" }> {
  return new Promise(resolve => {
    let finished = false;
    let next: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: T | { status: "cancelled" | "timeout" }) => {
      if (finished) return;
      finished = true;
      clearTimeout(next);
      clearTimeout(deadline);
      signal.removeEventListener("abort", cancel);
      resolve(result);
    };
    const cancel = () => finish({ status: "cancelled" });
    const poll = async () => {
      try {
        const result = await query();
        if (finished) return;
        if (result.status === "ok" || !result.recoveryPending) {
          finish(result);
          return;
        }
      } catch {
        // A transient read failure never authorizes resubmitting the paid request.
      }
      if (!finished) next = setTimeout(poll, IMAGE_TASK_POLL_MS);
    };
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener("abort", cancel, { once: true });
    deadline = setTimeout(() => finish({ status: "timeout" }), IMAGE_TASK_POLL_LIMIT_MS);
    void poll();
  });
}
