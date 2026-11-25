import type { BookRewriteTarget } from '@shared/bookRewrite';
import { readBookAudio } from '@shared/bookAudioBlock';
import { readBookImage } from '@shared/bookImageBlock';
import { captureBookRewrite } from './bookRewrite';
import { blockSubtreeEnd, isHeading, type WritingBlock } from './chapterBlockTree';

const quoted = /^(?:「([^」]+)」|『([^』]+)』|“([^”]+)”|‘([^’]+)’|"([^"]+)"|'([^']+)')$/u;

export type SentenceEdit = { old: string; text: string } | { section: string; text: string };

export function parseSentenceEdit(message: string): SentenceEdit | undefined {
  const request = message.trim().replace(/[。.!！]$/u, '');
  if (request.length > 6000 || /[\r\n]/u.test(request)) return;
  const expression = request.match(/^(?:(?:请)?(?:帮我)?(?:只)?[把将]\s*(.+?)\s*(?:改成|改为|替换成|替换为)\s*(.+)|(?:please\s+)?(?:replace|change)\s+(.+?)\s+(?:with|to)\s+(.+)\s*)$/iu);
  if (!expression) return;
  const target = expression[1] ?? expression[3];
  const replacement = (expression[2] ?? expression[4]).trim();
  const text = quoted.exec(replacement)?.slice(1).find(Boolean)?.trim();
  if (!text || text.length > 2000) return;
  const old = quoted.exec(target.trim())?.slice(1).find(Boolean);
  if (old) return { old, text };
  const position = target.match(/^(.*?)(?:的)?最后一句$/u) ??
    target.match(/^(?:the )?last sentence(?: (?:in|of) (.+))?$/iu);
  if (position) return { section: (position[1] ?? '').trim().replace(/^《|》$/gu, ''), text };
}

function headingName(block: WritingBlock) {
  const line = block.text.trim();
  if (isHeading(block)) return line;
  return line.match(/^(?:#{1,6}\s+(.+)|\*\*(.+?)\*\*(?:\s*[（(].*[）)])?)$/u)?.slice(1).find(Boolean);
}

function isProse(block: WritingBlock) {
  return block.text.trim() && !headingName(block) && !readBookImage(block.text) && !readBookAudio(block.text);
}

function lastSentence(text: string) {
  if (typeof Intl.Segmenter !== 'function') return;
  const sentences = new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text);
  const last = [...sentences].findLast(({ segment }) => segment.trim());
  if (!last) return;
  const body = last.segment.trim();
  return { start: last.index + last.segment.indexOf(body), length: body.length };
}

export function locateSentenceEdit(blocks: WritingBlock[], edit: SentenceEdit, source: { storyId: number; scope: string }): BookRewriteTarget | undefined {
  const prose = blocks.filter(isProse);
  const block = 'old' in edit ? prose.find(item => item.text.includes(edit.old)) : (() => {
    if (!edit.section) return prose.at(-1);
    const headings = blocks.flatMap((item, index) => headingName(item)?.toLowerCase() === edit.section.toLowerCase() ? [index] : []);
    if (headings.length !== 1) return;
    const start = headings[0];
    const explicitEnd = blockSubtreeEnd(blocks, start);
    const nextHeading = blocks.findIndex((item, index) => index > start && Boolean(headingName(item)));
    return blocks.slice(start + 1, explicitEnd > start + 1 ? explicitEnd : nextHeading < 0 ? undefined : nextHeading).findLast(isProse);
  })();
  if (!block) return;
  let range;
  if ('old' in edit) {
    const start = block.text.indexOf(edit.old);
    if (prose.some(item => item !== block && item.text.includes(edit.old)) || start !== block.text.lastIndexOf(edit.old)) return;
    range = { start, length: edit.old.length };
  } else {
    range = lastSentence(block.text);
  }
  if (!range || block.text.slice(range.start, range.start + range.length) === edit.text) return;
  return captureBookRewrite(blocks, [block.id], source, {
    anchor: { id: block.id, offset: range.start },
    focus: { id: block.id, offset: range.start + range.length },
  });
}
