import { afterEach, expect, it } from 'vitest';
import { archiveMessagesFrom } from '@/features/storyAgent/archiveChatMessages';
import { normalizeChatMessages, type ChatMessage } from '@/features/storyAgent/types';
import { applyBookRewrite } from './bookRewrite';
import { useBookModuleActions } from './bookModuleActions';
import { bookSentenceReviewReply } from './bookSentenceReviewChat';
import type { WritingBlock } from './chapterBlockTree';
import { locateSentenceEdit, parseSentenceEdit } from './sentenceEditTarget';

const source = { storyId: 7, scope: '7:chapter:2' };
const old = '那一下，我看见了，也记住了。';
const proposed = '那一下，我一直记得。';
const wechat = '爸，今天你把伞往我这边挪，我看见啦。';
const snapshot = { scope: source.scope, draft: '', cursor: 0 };
const instruction = `把书稿最后一句改成『${proposed}』`;
const block = (id: string, text: string, options?: Partial<WritingBlock>): WritingBlock =>
  ({ id, text, format: 'text', parentId: null, collapsed: false, ...options });

const document = [
  block('draft', '书稿', { format: 'heading1' }),
  block('prose', `他把自己的伞往我这边挪了挪。${old}  `, { parentId: 'draft' }),
  block('wechat', '给爸爸的微信', { format: 'heading1' }),
  block('message', wechat, { parentId: 'wechat' }),
];

afterEach(() => useBookModuleActions.getState().setSession(null));

it('proposes a single located edit and preserves the whole WeChat section when adopted', () => {
  const request: ChatMessage = { id: 'm1', role: 'user', content: instruction, timestamp: 1 };
  useBookModuleActions.getState().setSession({
    ...source, modules: document, convert() {}, merge() {},
    locateSentenceEdit: edit => locateSentenceEdit(document, edit, source),
  });
  const reply = bookSentenceReviewReply(request, source.storyId, snapshot)!;
  expect(reply.bookRewrite?.sentenceInstruction).toBe(instruction);
  expect(bookSentenceReviewReply(request, source.storyId, { ...snapshot, selection: { start: 0, end: 2 } })).toBeUndefined();
  expect(document[1].text).toContain(old);
  const archive = JSON.parse(JSON.stringify(archiveMessagesFrom([request, reply], [])));
  const reopened = normalizeChatMessages(archive, [])[1].bookRewrite!;
  const applied = applyBookRewrite(document, reopened.target, reopened.text);
  expect(applied.blocks.map(item => item.text)).toEqual([
    '书稿', `他把自己的伞往我这边挪了挪。${proposed}  `, '给爸爸的微信', wechat,
  ]);
  const edited = document.map(item => item.id === 'prose' ? { ...item, text: old + '后来雨停了。' } : item);
  expect(() => applyBookRewrite(edited, reopened.target, reopened.text)).toThrow('原文已变化');
});

it('fails closed when the section, quoted text, or visible final sentence is ambiguous', () => {
  const edit = parseSentenceEdit(instruction)!;
  expect(locateSentenceEdit(document.slice(1), edit, source)).toBeUndefined();
  expect(locateSentenceEdit(document, { old: '我', text: '她' }, source)).toBeUndefined();
  expect(locateSentenceEdit(document.map(item => item.id === 'draft' ? { ...item, collapsed: true } : item), edit, source)).toBeUndefined();
  expect(locateSentenceEdit([...document, block('duplicate', '书稿', { format: 'heading1' })], edit, source)).toBeUndefined();
  expect(parseSentenceEdit('今天下雨，我爸来车站接我。')).toBeUndefined();
  expect(bookSentenceReviewReply({ id: 'u', role: 'user', content: instruction, timestamp: 1 }, source.storyId, snapshot)?.bookRewrite).toBeUndefined();
});

it('accepts English and an exact quoted replacement, without adjusting adjacent text', () => {
  expect(parseSentenceEdit('Change the last sentence in Draft to "I remember."')).toEqual({ section: 'Draft', text: 'I remember.' });
  const edit = parseSentenceEdit(`把『${old}』改成『${proposed}』`)!;
  const target = locateSentenceEdit(document, edit, source)!;
  expect(target.parts[0].text.slice(target.parts[0].start, target.parts[0].end)).toBe(old);
});
