/**
 * 把聊聊整理好的那段话放回停笔处。
 *
 * 单独成函数是为了能直接测：插入位置错一个字、空行多一行，真机上很难发现，
 * 用户却会看到正文被打乱。
 */
export function insertParagraphAtCursor(
  draft: string,
  cursor: number,
  paragraph: string
): { body: string; cursor: number } {
  const text = paragraph.trim();
  const at = Math.min(Math.max(Math.trunc(cursor) || 0, 0), draft.length);
  if (!text) return { body: draft, cursor: at };
  const before = draft.slice(0, at);
  const after = draft.slice(at);
  const lead = before.trim() === "" ? "" : before.endsWith("\n") ? "" : "\n";
  const tail = after.trim() === "" ? "" : after.startsWith("\n") ? "" : "\n";
  const inserted = `${lead}${text}${tail}`;
  return {
    body: `${before}${inserted}${after}`,
    cursor: before.length + lead.length + text.length,
  };
}

export function replaceWritingSelection(
  draft: string,
  selection: { start: number; end: number },
  replacement: string
): { body: string; cursor: number } {
  const start = Math.min(Math.max(Math.trunc(selection.start) || 0, 0), draft.length);
  const end = Math.min(
    Math.max(Math.trunc(selection.end) || 0, start),
    draft.length
  );
  const text = replacement.trim();
  return {
    body: `${draft.slice(0, start)}${text}${draft.slice(end)}`,
    cursor: start + text.length,
  };
}

export type WritingCompanionStep =
  | { kind: "idle" }
  | { kind: "opening" }
  | { kind: "asking" }
  | { kind: "composing" }
  | { kind: "drafted"; paragraph: string }
  | { kind: "error"; message: string };

export function writingCompanionErrorMessage(error: unknown): string {
  const message =
    error instanceof Error && error.message.trim() ? error.message.trim() : "";
  if (!message || /fetch|network|Failed to/i.test(message)) {
    return "聊聊这次没接上，检查网络后再试一次。";
  }
  return message;
}

export type WritingCompanionSnapshot = {
  module?: import("@shared/layoutModuleContext").LayoutModuleContext;
  layoutMemory?: import("@shared/layoutOperationMemory").LayoutMemoryContext;
  draft: string;
  cursor: number;
  scope: string;
  selection?: { start: number; end: number };
};

export function assertWritingSnapshotCurrent(
  original: WritingCompanionSnapshot,
  current: WritingCompanionSnapshot
): void {
  if (
    original.scope !== current.scope ||
    original.draft !== current.draft ||
    original.selection?.start !== current.selection?.start ||
    original.selection?.end !== current.selection?.end
  ) {
    throw new Error(
      "正文或版本已经变化，暂未插入。请复制这段文字保留，回正文选择新的位置。"
    );
  }
}
