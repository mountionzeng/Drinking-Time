import { useEffect, type RefObject } from "react";
import type { ChatMessage } from "@/features/storyAgent/types";
import type { WarehouseShotGroup } from "./warehouseShotMedia";

export const WAREHOUSE_CONVERSATION_FOCUS = "dt:warehouse-conversation-focus";
export type WarehouseConversationFocus = { storyId: number; messageId: string; stableShotId?: string; mediaKeys: string[] };

/** Only durable output references count; numbers mentioned in prose are not proof of a result. */
export function warehouseConversationTarget(message: ChatMessage, storyId: number): WarehouseConversationFocus {
  const target: WarehouseConversationFocus = { storyId, messageId: message.id, mediaKeys: [] };
  if (message.role !== "assistant") return target;
  const review = message.frameReview;
  if (review?.storyId === storyId) {
    target.stableShotId = review.stableShotId;
    target.mediaKeys = [...review.tasks].sort((a, b) => Number(b.target === review.activeTarget) - Number(a.target === review.activeTarget))
      .flatMap(task => task.candidate ? [`image:${task.candidate.imageId}`] : []);
  }
  if (!target.mediaKeys.length && message.imageRevision?.storyId === storyId) {
    target.stableShotId = message.imageRevision.stableShotId;
    target.mediaKeys = [`image:${message.imageRevision.imageId}`];
  }
  if (!target.mediaKeys.length && !review) {
    const frames = message.frameReferences?.filter(frame => frame.storyId === storyId) ?? [];
    target.stableShotId = frames[0]?.stableShotId;
    target.mediaKeys = frames.map(frame => `image:${frame.imageId}`);
  }
  target.mediaKeys = [...new Set(target.mediaKeys)];
  return target;
}

export function resolveWarehouseConversationGroup(groups: WarehouseShotGroup[], focus: WarehouseConversationFocus) {
  if (!Array.isArray(focus.mediaKeys)) return undefined;
  return groups.find(group => (!focus.stableShotId || group.id === focus.stableShotId) &&
    focus.mediaKeys.some(key => group.items.some(item => item.key === key)));
}

export function focusWarehouseConversation(message: ChatMessage, storyId: number) {
  window.dispatchEvent(new CustomEvent(WAREHOUSE_CONVERSATION_FOCUS, { detail: warehouseConversationTarget(message, storyId) }));
}

/** Follow deliberate history browsing only. Background replies never move or open the warehouse. */
export function useWarehouseConversationFocus(input: {
  storyId: number | null; enabled: boolean; messages: ChatMessage[];
  container: RefObject<HTMLDivElement | null>; nodes: RefObject<Map<string, HTMLDivElement>>;
}) {
  useEffect(() => {
    const root = input.container.current;
    if (!input.enabled || !input.storyId || !root) return;
    const storyId = input.storyId;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let userScrollUntil = 0;
    let lastMessageId = "";
    const follow = () => {
      const rect = root.getBoundingClientRect();
      const middle = rect.top + rect.height / 2;
      const visible = input.messages.map(message => ({ message, rect: input.nodes.current.get(message.id)?.getBoundingClientRect() }))
        .filter((item): item is { message: ChatMessage; rect: DOMRect } => Boolean(item.rect && item.rect.bottom > rect.top && item.rect.top < rect.bottom))
        .sort((a, b) => Math.abs((Math.max(a.rect.top, rect.top) + Math.min(a.rect.bottom, rect.bottom)) / 2 - middle)
          - Math.abs((Math.max(b.rect.top, rect.top) + Math.min(b.rect.bottom, rect.bottom)) / 2 - middle));
      const message = visible[0]?.message;
      if (message && message.id !== lastMessageId) { lastMessageId = message.id; focusWarehouseConversation(message, storyId); }
    };
    const scroll = () => {
      if (Date.now() > userScrollUntil) return;
      clearTimeout(timer); timer = setTimeout(follow, 140);
    };
    const intent = () => { userScrollUntil = Date.now() + 1200; scroll(); };
    const key = (event: KeyboardEvent) => {
      if (!(event.target as Element)?.closest("input,textarea,[contenteditable=true]") && ["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"].includes(event.key)) intent();
    };
    root.addEventListener("wheel", intent, { passive: true });
    root.addEventListener("touchmove", intent, { passive: true });
    root.addEventListener("keydown", key);
    root.addEventListener("scroll", scroll, { passive: true });
    return () => { clearTimeout(timer); root.removeEventListener("wheel", intent); root.removeEventListener("touchmove", intent); root.removeEventListener("keydown", key); root.removeEventListener("scroll", scroll); };
  }, [input.storyId, input.enabled, input.messages, input.container, input.nodes]);
}
