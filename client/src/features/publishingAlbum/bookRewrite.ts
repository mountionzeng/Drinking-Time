import { bookRewriteSource, type BookRewriteTarget } from '@shared/bookRewrite';
import { bookTextRangeParts, replaceBookTextRange, type BookTextRange } from './bookTextRange';
import { blockBody, type WritingBlock } from './chapterBlockTree';
import { layoutBookBlocks } from './bookBlockLayout';

export function captureBookRewrite(blocks: WritingBlock[], ids: string[], source: { storyId: number; scope: string }, range?: BookTextRange | null): BookRewriteTarget | undefined {
  const chosen = blocks.filter(block => ids.includes(block.id));
  if (!chosen.length || chosen.length !== ids.length || ids.length > 200) return;
  const first = chosen[0], last = chosen.at(-1)!;
  const parts = bookTextRangeParts(blocks, range ?? {
    anchor: { id: first.id, offset: 0 }, focus: { id: last.id, offset: last.text.length },
  });
  const visible = new Set(layoutBookBlocks(blocks).map(item => item.block.id));
  if (parts.length !== chosen.length || parts.some((part, i) => part.id !== chosen[i].id || !visible.has(part.id))) return;
  const target = { ...source, parts };
  const text = bookRewriteSource(target);
  return text.trim() && text.length <= 12_000 ? target : undefined;
}

export function applyBookRewrite(blocks: WritingBlock[], target: BookRewriteTarget, text: string) {
  const first = target.parts[0], last = target.parts.at(-1)!;
  const start = blocks.findIndex(block => block.id === first.id);
  const visible = new Set(layoutBookBlocks(blocks).map(item => item.block.id));
  if (start < 0 || target.parts.some((part, i) => blocks[start + i]?.id !== part.id || blocks[start + i]?.text !== part.text || !visible.has(part.id)))
    throw new Error('原文已变化，请重新选中并让聊聊改写。');
  if (!text.trim() || text.length > 20_000) throw new Error('这段改写暂时无法替换。');
  const result = replaceBookTextRange(blocks, {
    anchor: { id: first.id, offset: first.start }, focus: { id: last.id, offset: last.end },
  }, text);
  if (!result || blockBody(result.blocks).length > 200_000) throw new Error('这段改写暂时无法替换。');
  return result;
}
