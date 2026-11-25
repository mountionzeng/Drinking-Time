import { readBookAudio } from '@shared/bookAudioBlock';
import { readBookImage } from '@shared/bookImageBlock';
import { bookRewriteSource, type BookRewriteProposal, type BookRewriteTarget } from '@shared/bookRewrite';
import { captureBookRewrite } from './bookRewrite';
import { layoutBookBlocks } from './bookBlockLayout';
import { isHeading, type WritingBlock } from './chapterBlockTree';

export type PassageReference =
  | { kind: 'recent' }
  | { kind: 'current' }
  | { kind: 'mention'; text: string; side?: 'first' | 'last'; locateOnly?: boolean };

export function parsePassageReference(input: string): PassageReference | undefined {
  const text = input.trim();
  if (/^(?:如果|比如|假如|不要|不用|别|只记|假设)/u.test(text)) return;
  const requestsChange = /(?:^|[，,：:\s])(?:请|帮我)?(?:rewrite|shorten|revise|polish)\b/iu.test(text) ||
    /(?:收短|压缩|精简|缩短|重写|润色|更?口语|改一下|改短)(?:一?[点下些]|一点儿)?[。.!！？?]?$/u.test(text) ||
    /^(?:(?:请|帮我|我想|能不能)\s*)*[把将].{1,100}(?:改得|改写|改成|改为|再改|读起来)/u.test(text);
  const named = text.match(/(?:(前面|开头|后面|结尾)\s*)?(?:写到?|提到|讲到?|关于)\s*[「『“"]?([^「『“"」』”"，。！？、\n]{1,32}?)[」』”"]?(?:的)?(?:那一?段|这一?段|那一?句)/u);
  const locateOnly = !requestsChange && named?.[0] === text.replace(/[。.!！]$/u, '');
  if (named && (requestsChange || locateOnly)) return {
    kind: 'mention', text: named[2].trim(),
    ...(locateOnly && { locateOnly: true }),
    ...named[1] && { side: /前面|开头/u.test(named[1]) ? 'first' : 'last' },
  };
  if (!requestsChange) return;
  if (/(?:刚才|刚刚|上次|上一版)(?:改过的|改的|的)?(?:那|一|这)?(?:一句|一段|句|段)|(?:that|the) (?:last|previous) (?:sentence|passage)/iu.test(text))
    return { kind: 'recent' };
  if (/(?:这(?:一|里的一)?段|这一?句|当前段落)|(?:this|the current) (?:paragraph|sentence|passage)/iu.test(text))
    return { kind: 'current' };
}

function isPassage(block: WritingBlock) {
  return !isHeading(block) && !/^(?:#{1,6}\s|\*\*.+\*\*(?:[（(].*[）)])?\s*$)/u.test(block.text.trim()) &&
    !readBookImage(block.text) && !readBookAudio(block.text);
}

function capturePassage(blocks: WritingBlock[], block: WritingBlock, source: { storyId: number; scope: string }, start = 0, end = block.text.length) {
  if (!isPassage(block)) return;
  const target = captureBookRewrite(blocks, [block.id], source, {
    anchor: { id: block.id, offset: start }, focus: { id: block.id, offset: end },
  });
  if (target) target.parts[0].parentId = block.parentId;
  return target;
}

export function recheckPassage(blocks: WritingBlock[], target: BookRewriteTarget) {
  if (target.parts.length !== 1) return;
  const part = target.parts[0], block = blocks.find(item => item.id === part.id);
  if (!block || block.text !== part.text || (part.parentId !== undefined && block.parentId !== part.parentId)) return;
  return capturePassage(blocks, block, target, part.start, part.end);
}

export function findPassages(
  blocks: WritingBlock[], reference: PassageReference, source: { storyId: number; scope: string }, currentId?: string
) {
  if (reference.kind === 'recent') return [];
  if (reference.kind === 'current') {
    const block = blocks.find(item => item.id === currentId);
    const target = block && capturePassage(blocks, block, source);
    return target ? [target] : [];
  }
  const visible = new Set(layoutBookBlocks(blocks).map(({ block }) => block.id));
  const body = blocks.filter(block => visible.has(block.id) && isPassage(block) && block.text.trim());
  const mid = Math.ceil(body.length / 2);
  const matches = body.flatMap((block, index) =>
    block.text.toLowerCase().includes(reference.text.toLowerCase()) ? [{ block, index }] : []);
  const candidates = matches.length > 1 && reference.side
    ? matches.filter(({ index }) => reference.side === 'first' ? index < mid : index >= mid)
    : matches;
  const safe = candidates.length ? candidates : matches;
  const shortlist = safe.slice(0, 3);
  return shortlist.flatMap(({ block }) => {
    const target = capturePassage(blocks, block, source);
    return target ? [target] : [];
  });
}

export function resumeBookPassage(blocks: WritingBlock[], proposal: BookRewriteProposal) {
  const target = recheckPassage(blocks, proposal.target);
  if (target) return { target, previousText: proposal.text };
  if (proposal.target.parts.length !== 1) return;
  const part = proposal.target.parts[0];
  const block = blocks.find(item => item.id === part.id);
  const accepted = part.text.slice(0, part.start) + proposal.text + part.text.slice(part.end);
  if (block?.text !== accepted || (part.parentId !== undefined && block.parentId !== part.parentId)) return;
  const rebased = capturePassage(blocks, block, proposal.target, part.start, part.start + proposal.text.length);
  if (rebased) return { target: rebased, previousText: bookRewriteSource(rebased) };
}
