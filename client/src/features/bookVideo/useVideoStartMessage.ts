import { useEffect, useMemo, useState } from "react";
import type { ChatMessage } from "@/features/storyAgent/types";
import { browserStoryViewStorage } from "@/pages/storyWorkspacePreference";

type StartTurn = { id: string; timestamp: number; openedAt: number };

// Keep the invitation at the point where this device first opened the editor.
// It is a view preference, so it never changes the manuscript or model history.
export function useVideoStartMessage(id: string | null, messages: ChatMessage[]) {
  const [turn, setTurn] = useState<StartTurn | null>(null);
  useEffect(() => {
    if (!id) return;
    let timestamp = Date.now(), openedAt = timestamp;
    const storage = browserStoryViewStorage();
    try {
      const saved = JSON.parse(storage?.getItem(id) ?? "null");
      if (Number.isSafeInteger(saved?.timestamp) && Number.isSafeInteger(saved.openedAt)) {
        timestamp = saved.timestamp;
        openedAt = saved.openedAt;
      } else storage?.setItem(id, JSON.stringify({ timestamp, openedAt }));
    } catch { /* Storage is optional. */ }
    setTurn({ id, timestamp, openedAt });
  }, [id]);
  const active = turn && turn.id === id ? turn : null;
  const history = useMemo(() => {
    if (!active) return messages;
    const invitation: ChatMessage = { id: active.id, role: "assistant", timestamp: active.timestamp,
      content: "这条视频，你想先做什么？也可以直接告诉我其他想法。", interfaceAction: true };
    const next = messages.findIndex(row => row.timestamp > invitation.timestamp);
    const index = next < 0 ? messages.length : next;
    return [...messages.slice(0, index), invitation, ...messages.slice(index)];
  }, [active, messages]);
  const expanded = !!active && active.openedAt > 0 && !messages.some(row => row.role === "user" && row.timestamp > active.openedAt);
  function setExpanded(open: boolean) {
    if (!active) return;
    const next = { ...active, openedAt: open ? Date.now() : 0 };
    setTurn(next);
    try { browserStoryViewStorage()?.setItem(next.id, JSON.stringify(next)); } catch { /* Keep the in-memory choice. */ }
  }
  return { history, messageId: active?.id, expanded, setExpanded };
}
