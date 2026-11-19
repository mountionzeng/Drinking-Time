import type { ChatImageRevision } from "@shared/chatImageRevision";

/** Place durable receipts beside their original turn, never after newer chat. */
export function chatRevisionSlots(
  messages: readonly { id: string; timestamp: number }[],
  revisions: readonly ChatImageRevision[],
) {
  const slots = new Map<string | null, ChatImageRevision[]>();
  const turns = [...messages].sort((a, b) => a.timestamp - b.timestamp);
  const time = (row: ChatImageRevision) => Number.isFinite(row.createdAt) ? row.createdAt : 0;
  for (const revision of [...revisions].sort((a, b) => time(a) - time(b) || a.requestId.localeCompare(b.requestId))) {
    let anchor: string | null = null;
    for (const message of turns) {
      if (!Number.isFinite(revision.createdAt) || message.timestamp > revision.createdAt) break;
      anchor = message.id;
    }
    slots.set(anchor, [...(slots.get(anchor) ?? []), revision]);
  }
  return slots;
}
