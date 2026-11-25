import { useMemo } from "react";
import { requestedSceneGrouping } from "@shared/bookShotFormat";
import { useStorySpine } from "./spine/storySpine";

function preferenceKey(accountId: number, storyId: number) { return `dt:story-view:${accountId}:${storyId}:scenes`; }

export function rememberStoryboardScenes(accountId: number | null, storyId: number, enabled: boolean, at: number) {
  if (!accountId) return;
  try { localStorage.setItem(preferenceKey(accountId, storyId), JSON.stringify({ enabled, at })); } catch { /* use chat history */ }
}

/** A scene outline belongs to the active story and the author's instructions. */
export function useStoryboardScenes(storyId?: number | null, saved = false) {
  const accountId = useStorySpine(state => state.accountId);
  const messages = useStorySpine(state => state.activeStoryId === storyId ? state.messages : null);
  return useMemo(() => {
    if (!storyId || !messages) return saved;
    let at = 0, choice = saved;
    if (accountId) {
      try {
        const local = JSON.parse(localStorage.getItem(preferenceKey(accountId, storyId)) ?? "null");
        if (typeof local?.enabled === "boolean" && Number.isFinite(local.at)) { at = local.at; choice = local.enabled; }
      } catch { /* history remains available */ }
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.timestamp <= at) break;
      if (m.role !== "user") continue;
      const requested = requestedSceneGrouping(m.content);
      if (requested !== undefined) return requested;
    }
    return choice;
  }, [accountId, messages, saved, storyId]);
}
