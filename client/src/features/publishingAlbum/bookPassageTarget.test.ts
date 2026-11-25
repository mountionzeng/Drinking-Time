import { afterEach, expect, it } from 'vitest';
import { archiveMessagesFrom } from '@/features/storyAgent/archiveChatMessages';
import { normalizeChatMessages, type ChatMessage } from '@/features/storyAgent/types';
import { useBookModuleActions } from './bookModuleActions';
import { applyBookRewrite } from './bookRewrite';
import { parsePassageReference, recheckPassage } from './bookPassageTarget';
import { bookRewriteReplyMetadata, prepareBookReview } from './bookSentenceReviewChat';
import { blockBody, type WritingBlock } from './chapterBlockTree';

const source = { storyId: 29, scope: '7:29:chapter:42' };
const block = (id: string, text: string, fields?: Partial<WritingBlock>): WritingBlock =>
  ({ id, text, format: 'text', collapsed: false, parentId: 'book', ...fields });
const earlier = '刚出车站时，雨已经下了一阵，爸爸只把伞往我这边挪了一点。';
const later = '多年后回到车站，又下起雨。我看见屋檐下有两把伞。';
const original = [
  block('book', '书稿', { format: 'heading1', parentId: null }),
  block('begin', earlier),
  ...Array.from({ length: 60 }, (_, i) => block(`p${i}`, `第${i}自然段。沿河走时我们记了一些小事。`.repeat(9))),
  block('end', later),
  block('wx', '给爸爸的微信', { format: 'heading1', parentId: null }),
  block('wx-copy', '爸，今天你把伞往我这边挪，我看见啦。', { parentId: 'wx' }),
];
const title = '车站的两把伞';
const snapshot = (blocks = original, chapterVersion = 3) => ({
  draft: blockBody(blocks), cursor: blockBody(blocks).length, scope: source.scope,
  chapterId: '42', chapterTitle: title, chapterVersion,
});
const user = (content: string, id = 'm1'): ChatMessage => ({ id, role: 'user', content, timestamp: Number(id.slice(1)) });
function mount(blocks = original) {
  useBookModuleActions.getState().setSession({
    ...source, modules: blocks, convert() {}, merge() {},
    chapterDocument: { chapterId: '42', body: blockBody(blocks), blocks },
  });
}
afterEach(() => useBookModuleActions.getState().setSession(null));

it('searches the full draft and pins the early match despite a similar closing passage', () => {
  mount();
  const message = user('前面写车站的那段，收短一点');
  const prepared = prepareBookReview(message, source.storyId, snapshot(), [])!;
  expect(prepared.writingContext?.rewriteSource).toBe(earlier);
  expect(prepared.writingContext?.module?.bookPassage).toMatchObject({
    start: '书稿\n'.length, chapterVersion: 3, chapterTitle: title, instruction: message.content,
  });
  expect(prepared.writingContext?.draft.length).toBeGreaterThan(6000);
  expect(prepared.writingContext?.bookRewriteTarget?.parts[0].id).toBe('begin');
  expect(parsePassageReference('今天在车站看到爸爸，想起来还是很温暖。')).toBeUndefined();
});

it('shows two excerpts before generating and remembers the chosen scope after reopening', () => {
  mount();
  const message = user('写车站的那段收短一点');
  const prepared = prepareBookReview(message, source.storyId, snapshot(), [])!;
  expect(prepared.reply?.content).toContain(earlier);
  expect(prepared.reply?.content).toContain(later);
  expect(prepared.writingContext).toBeUndefined();
  const restored = normalizeChatMessages(archiveMessagesFrom([message, prepared.reply!], []), []);
  const choice = prepareBookReview(user('2', 'm2'), source.storyId, snapshot(), restored)!;
  expect(choice.writingContext?.rewriteSource).toBe(later);
  expect(choice.writingContext?.module?.bookPassage?.instruction).toBe(message.content);
  const changed = original.map(item => item.id === 'end' ? { ...item, text: later + '新改动。' } : item);
  mount(changed);
  expect(prepareBookReview(user('2', 'm3'), source.storyId, snapshot(changed), restored)?.writingContext).toBeUndefined();
});

it('refines the previous wording before or after adopting it and keeps other final copy untouched', () => {
  mount();
  const first = user('前面写车站的那段，收短一点');
  const context = prepareBookReview(first, source.storyId, snapshot(), [])!.writingContext!;
  const shorter = '刚出车站，爸爸就把伞往我这边挪。';
  const reply: ChatMessage = { id:'reply:m1', role:'assistant', timestamp:2, content:'改短了一版。', ...bookRewriteReplyMetadata(shorter, context) };
  const restored = normalizeChatMessages(archiveMessagesFrom([first, reply], []), []);
  const next = user('把刚才那句再改得口语一点', 'm3');
  const pending = prepareBookReview(next, source.storyId, snapshot(), restored)!.writingContext!;
  expect(pending.rewriteSource).toBe(earlier);
  expect(pending.module?.bookPassage?.previousText).toBe(shorter);
  expect(pending.module?.bookPassage?.previousInstruction).toBe(first.content);

  const adopted = applyBookRewrite(original, reply.bookRewrite!.target, shorter).blocks;
  mount(adopted);
  const revised = prepareBookReview(next, source.storyId, snapshot(adopted, 4), restored)!.writingContext!;
  expect(revised.rewriteSource).toBe(shorter);
  expect(revised.module?.bookPassage?.chapterVersion).toBe(4);
  expect(adopted.filter(item => item.id !== 'begin')).toEqual(original.filter(item => item.id !== 'begin'));
  const changed = adopted.map(item => item.id === 'begin' ? {...item, text: '我手工改了前面那段。'} : item);
  mount(changed);
  expect(prepareBookReview(next, source.storyId, snapshot(changed), restored)?.writingContext).toBeUndefined();
  expect(recheckPassage(changed, revised.bookRewriteTarget!)).toBeUndefined();
});

it('remembers a located paragraph across reopening when the user gives the editing instruction next', () => {
  mount();
  const request = user('前面写车站的那段');
  const focus = prepareBookReview(request, source.storyId, snapshot(), [])!.reply!;
  expect(focus.bookRewriteFocus?.parts[0].id).toBe('begin');
  expect(focus.content).toContain(earlier);
  const restored = normalizeChatMessages(archiveMessagesFrom([request, focus], []), []);
  const follow = prepareBookReview(user('这一段收短一点', 'm3'), source.storyId, snapshot(), restored)!;
  expect(follow.writingContext?.rewriteSource).toBe(earlier);
  expect(follow.writingContext?.module?.bookPassage?.instruction).toBe('这一段收短一点');
});
