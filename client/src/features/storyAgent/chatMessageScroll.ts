type Message = { id: string; role: string; timestamp: number };
type QueuedMessage = { id: string; createdAt: number };

/** Follow the conversation, not the archive/gallery rendered after it. */
export function scrollToLatestChatTurn(
  scroller: HTMLElement,
  nodes: Map<string, HTMLElement>,
  messages: readonly Message[],
  queued: readonly QueuedMessage[] = [],
) {
  const latest = messages.at(-1);
  const pending = [...queued].reverse().find(item => !messages.some(message => message.id === item.id));
  const queuedIsLatest = pending && (!latest || pending.createdAt >= latest.timestamp);
  const id = queuedIsLatest ? pending.id : latest?.id;
  const node = id ? nodes.get(id) : undefined;
  if (!node) return;

  const viewport = scroller.getBoundingClientRect();
  const rect = node.getBoundingClientRect();
  const text = node.querySelector('[data-chat-message-text]')?.getBoundingClientRect() ?? rect;
  const result = node.querySelector('[data-chat-result-preview]')?.getBoundingClientRect();
  const previous = messages.at(-2);
  const user = !queuedIsLatest && latest?.role === "assistant" && previous?.role === "user"
    ? nodes.get(previous.id)?.getBoundingClientRect() : undefined;
  const top = user?.top ?? rect.top;
  const room = scroller.clientHeight - 24;
  // A tall preview must not push the user's request and reply text off screen.
  const bottom = result?.bottom ?? (rect.bottom - top <= room ? rect.bottom : text.bottom);
  const offset = result
    ? (result.bottom - result.top <= room ? result.bottom - viewport.top - scroller.clientHeight + 12 : result.top - viewport.top - 12)
    : bottom - top <= room
    ? bottom - viewport.top - scroller.clientHeight + 12
    : text.top - viewport.top - 12;
  scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + offset), behavior: "auto" });
}
