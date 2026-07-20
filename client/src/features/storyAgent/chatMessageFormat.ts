export type ChatTextSegment = {
  text: string;
  emphasis: boolean;
};

export function tokenizeChatMessageText(content: string): ChatTextSegment[] {
  const segments: ChatTextSegment[] = [];
  const pattern = /\*\*([\s\S]+?)\*\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const index = match.index;
    if (index > cursor) {
      segments.push({
        text: content.slice(cursor, index),
        emphasis: false,
      });
    }
    segments.push({
      text: match[1],
      emphasis: true,
    });
    cursor = index + match[0].length;
  }

  if (cursor < content.length) {
    segments.push({
      text: content.slice(cursor),
      emphasis: false,
    });
  }

  return segments.length > 0
    ? segments
    : [{ text: content, emphasis: false }];
}
