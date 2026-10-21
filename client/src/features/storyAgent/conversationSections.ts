/** 两端用同一时间间隔划分聊天目录，不推断或改写话题。 */
export function conversationSections<
  T extends { id: string; timestamp: number; source?: string },
>(messages: readonly T[]) {
  const groups: {
    id: string;
    timestamp: number;
    messages: T[];
  }[] = [];
  for (const message of messages) {
    if (message.source === "recovery") continue;
    const previous = groups.at(-1);
    const last = previous?.messages.at(-1);
    if (
      !previous ||
      (last && message.timestamp - last.timestamp > 30 * 60_000)
    ) {
      groups.push({
        id: message.id,
        timestamp: message.timestamp,
        messages: [message],
      });
    } else previous.messages.push(message);
  }
  return groups;
}
