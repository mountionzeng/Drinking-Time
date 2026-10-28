import { bookWritingStyleSchema, sameWritingStyle, validWritingStyle, type BookWritingStyle } from "@shared/bookWritingStyle";
export type ChapterWritingDraft = { title: string; body: string; changeNote?: string; writingStyle?: BookWritingStyle; baseVersion: number | null };
type SavedText = { title: string; body: string; version: number; writingStyle?: BookWritingStyle };

/** Old/unknown cache is recoverable, but never silently inherits the current server save token. */
export function restoreChapterWritingDraft(raw: string | null, saved: SavedText): ChapterWritingDraft {
  try {
    const stored = JSON.parse(raw ?? 'null');
    if (stored && typeof stored.title === 'string' && typeof stored.body === 'string') {
      const parsed = bookWritingStyleSchema.safeParse(stored.writingStyle);
      const writingStyle = parsed.success && validWritingStyle(stored.body,parsed.data) ? parsed.data : stored.body===saved.body ? saved.writingStyle : undefined;
      const matches = sameWritingStyle(writingStyle,saved.writingStyle) && stored.title === saved.title && stored.body === saved.body;
      return { title: stored.title, body: stored.body, ...(writingStyle ? {writingStyle} : {}),
        ...(typeof stored.changeNote === 'string' ? {changeNote:stored.changeNote} : {}),
        baseVersion: matches ? saved.version : Number.isSafeInteger(stored.baseVersion) && stored.baseVersion > 0 ? stored.baseVersion : null };
    }
  } catch { /* Corrupt cache is retained in storage but must not replace the server manuscript. */ }
  return { title: saved.title, body: saved.body, baseVersion: saved.version, ...(saved.writingStyle ? {writingStyle:saved.writingStyle} : {}) };
}

export function draftNeedsVersionReview(draft: ChapterWritingDraft, saved: SavedText): boolean {
  return (draft.title !== saved.title || draft.body !== saved.body || !sameWritingStyle(draft.writingStyle,saved.writingStyle)) && draft.baseVersion !== saved.version;
}
