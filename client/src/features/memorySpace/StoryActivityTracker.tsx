import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import { ActiveEditingClock } from "./activeEditingClock";

/** Mounted only for the current editor. Nothing is recorded until an actual interaction. */
export function StoryActivityTracker({
  storyId,
  userId,
  enabled = true,
}: {
  storyId: number | null;
  userId: number | null;
  enabled?: boolean;
}) {
  const utils = trpc.useUtils();
  useEffect(() => {
    if (!enabled || !storyId || storyId < 1 || !userId) return;
    const sessionId = crypto.randomUUID();
    const clock = new ActiveEditingClock(performance.now());
    let started = false,
      busy = false,
      disposed = false,
      sent = -1,
      queued = false,
      lastInteractionAt = -Infinity;
    const eligible = () =>
      document.visibilityState === "visible" &&
      document.hasFocus() &&
      !document.querySelector('[role="dialog"][data-state="open"]') &&
      storySpineStore.getState().accountId === userId;
    const flush = async (force = false) => {
      if (!started || storySpineStore.getState().accountId !== userId) return;
      if (busy) {
        queued ||= force;
        return;
      }
      const elapsedMs = Math.min(86_400_000, Math.floor(clock.elapsedMs));
      if (
        (!force && elapsedMs === sent) ||
        (!force && sent >= 0 && elapsedMs - sent < 15_000)
      )
        return;
      busy = true;
      try {
        await utils.client.memorySpace.activity.mutate({
          storyId,
          sessionId,
          elapsedMs,
        });
        sent = elapsedMs;
      } catch {
        /* A later cumulative heartbeat retries; offline time is conservatively capped by the server. */
      } finally {
        busy = false;
        if (queued) {
          queued = false;
          void flush(true);
        }
      }
    };
    const interact = (event: Event) => {
      if (!eligible() || !event.isTrusted || !(event.target instanceof Element))
        return;
      if (
        event.target
          .closest("[data-story-activity]")
          ?.getAttribute("data-story-activity") !== String(storyId)
      )
        return;
      if (
        !event.target.closest(
          "input,textarea,button,select,[contenteditable=true],[role=slider]"
        )
      )
        return;
      const now = performance.now();
      const resumed = now - lastInteractionAt > 30_000;
      lastInteractionAt = now;
      clock.interact(now);
      started = true;
      void flush(resumed);
    };
    const tick = () => {
      clock.sample(performance.now(), eligible());
      void flush();
    };
    const suspend = () => {
      const now = performance.now();
      clock.sample(now, true);
      clock.sample(now, false);
      void flush(true);
    };
    const interval = window.setInterval(tick, 5_000);
    for (const name of ["input", "keydown", "pointerdown"])
      document.addEventListener(name, interact, true);
    document.addEventListener("visibilitychange", suspend);
    window.addEventListener("blur", suspend);
    window.addEventListener("pagehide", suspend);
    return () => {
      if (disposed) return;
      disposed = true;
      window.clearInterval(interval);
      for (const name of ["input", "keydown", "pointerdown"])
        document.removeEventListener(name, interact, true);
      document.removeEventListener("visibilitychange", suspend);
      window.removeEventListener("blur", suspend);
      window.removeEventListener("pagehide", suspend);
      clock.sample(performance.now(), eligible());
      void flush(true);
    };
  }, [storyId, userId, enabled, utils.client]);
  return null;
}
