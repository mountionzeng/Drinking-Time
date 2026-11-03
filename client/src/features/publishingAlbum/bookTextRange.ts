import { readBookAudio } from '@shared/bookAudioBlock';
import { readBookImage } from '@shared/bookImageBlock';
import { insertBlockText, writingBlockOffset, type WritingBlock } from './chapterBlockTree';
import { mergeBookText } from './mergeBookText';

export type BookTextPoint = { id: string; offset: number };
export type BookTextRange = { anchor: BookTextPoint; focus: BookTextPoint };

export function bookTextRangeParts(blocks: WritingBlock[], range: BookTextRange) {
  const a = blocks.findIndex(block => block.id === range.anchor.id);
  const b = blocks.findIndex(block => block.id === range.focus.id);
  if (a < 0 || b < 0) return [];
  const forward = a < b || a === b && range.anchor.offset <= range.focus.offset;
  const start = forward ? range.anchor : range.focus;
  const end = forward ? range.focus : range.anchor;
  const items = blocks.slice(Math.min(a, b), Math.max(a, b) + 1);
  if (items.some(block => readBookImage(block.text) || readBookAudio(block.text))) return [];
  return items.map(block => ({
    id: block.id,
    start: block.id === start.id ? Math.max(0, Math.min(start.offset, block.text.length)) : 0,
    end: block.id === end.id ? Math.max(0, Math.min(end.offset, block.text.length)) : block.text.length,
    text: block.text,
  }));
}

/** Stop at media or folded content; selecting visible prose must not delete hidden text. */
export function clampBookTextFocus(blocks: WritingBlock[], visible: ReadonlySet<string>, anchor: BookTextPoint, focus: BookTextPoint): BookTextPoint {
  const a = blocks.findIndex(block => block.id === anchor.id);
  const b = blocks.findIndex(block => block.id === focus.id);
  if (a < 0 || b < 0) return anchor;
  const direction = b >= a ? 1 : -1;
  for (let i = a + direction; direction > 0 ? i <= b : i >= b; i += direction) {
    const block = blocks[i];
    if (!visible.has(block.id) || readBookImage(block.text) || readBookAudio(block.text)) {
      const last = blocks[i - direction];
      return { id: last.id, offset: direction > 0 ? last.text.length : 0 };
    }
  }
  return focus;
}

export function replaceBookTextRange(blocks: WritingBlock[], range: BookTextRange, inserted: string) {
  const parts = bookTextRangeParts(blocks, range);
  if (!parts.length) return null;
  const first = parts[0], last = parts.at(-1)!;
  const normalized = inserted.replace(/\r\n?/g, '\n');
  const text = first.text.slice(0, first.start) + normalized + last.text.slice(last.end);
  const merged = parts.length > 1 ? mergeBookText(blocks, parts.map(part => part.id)) : blocks;
  const index = merged.findIndex(block => block.id === first.id);
  const result = normalized.includes('\n')
    ? insertBlockText(merged, index, text).blocks
    : merged.map((block, i) => i === index ? { ...block, text } : block);
  return { blocks: result, position: writingBlockOffset(result, index) + first.start + normalized.length };
}
