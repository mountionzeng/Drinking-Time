import type { TextChange } from './textChanges';

export type WritingComparison = { body: string; title: string; label: string; editorName?: string; note?: string };

export function ChangedText({ changes, side }: { changes: TextChange[]; side: 'before' | 'after' }) {
  return <>{changes.filter(part => part.kind !== (side === 'before' ? 'added' : 'removed')).map((part, index) =>
    part.kind === 'removed' ? <del key={index} className="bg-red-50 text-red-800 decoration-2">{part.text}</del>
    : part.kind === 'added' ? <mark key={index} className="bg-red-50 text-red-800 underline decoration-2">{part.text}</mark>
    : <span key={index}>{part.text}</span>)}</>;
}

/** Map the whole-document diff to the existing editable paragraph, using UTF-16 caret offsets. */
export function afterTextSlice(changes: TextChange[], start: number, end: number): TextChange[] {
  let offset = 0;
  return changes.flatMap(part => {
    if (part.kind === 'removed') return [];
    const from = Math.max(0, start - offset);
    const to = Math.min(part.text.length, end - offset);
    offset += part.text.length;
    return to > from ? [{ kind: part.kind, text: part.text.slice(from, to) }] : [];
  });
}
