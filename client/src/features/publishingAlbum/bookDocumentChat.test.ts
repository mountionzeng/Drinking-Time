import { expect, it, vi } from 'vitest';
import { archiveMessagesFrom } from '@/features/storyAgent/archiveChatMessages';
import { normalizeChatMessages, type ChatMessage } from '@/features/storyAgent/types';
import { bookChatReplyMetadata, isBookWritingMaterialTurn, prepareBookTurn } from './bookDocumentChat';

const storyId = 29;
const snapshot = { scope: '7:29:chapter:42', draft: '', cursor: 0, chapterVersion: 3, manuscriptKind: 'text' as const };
const draft = '那天下雨，爸爸来车站接我。他带了两把伞，见面后，还是把他那把往我这边挪了挪。';
const wechat = '爸，今天你把伞往我这边挪，我看见啦。';
const notes = `旧稿写过他递给我一把，我们并肩走着，这两点我记不清。\n\n留给爸爸的微信（已定稿，原话）：\n${wechat}\n这里是编辑说明，不属于微信。`;
const request = '这版就定了。帮我建一份叫《车站的两把伞》的文档，把刚才的书稿和之前定下来的那条微信分开放进去，两段都按原话保存';
const turn = (id: string, content: string, role: ChatMessage['role'] = 'user'): ChatMessage =>
  ({ id, role, content, timestamp: Date.now() });

it('preserves the last actual manuscript candidate and the user-marked original wording across reopening', async () => {
  const last = { ...turn('updated', draft, 'assistant'), ...bookChatReplyMetadata({ bookDraft: draft }, snapshot, storyId) };
  const earlier = '见面时他递给我一把，我们并肩走着。';
  const messages = [turn('notes', notes),
    { ...turn('initial', earlier, 'assistant'), ...bookChatReplyMetadata({ bookDraft: earlier }, snapshot, storyId) },
    last, turn('separate', '助手写的微信原话：爸，别淋雨。', 'assistant')];
  const reopened = normalizeChatMessages(JSON.parse(JSON.stringify(archiveMessagesFrom(messages, []))), []);
  const create = vi.fn(async () => ({ id: 56, title: '车站的两把伞', storyId }));

  const result = await prepareBookTurn(turn('save-turn', request), storyId, snapshot, reopened, create);
  expect(create).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledWith({
    storyId, title: '车站的两把伞', kind: 'text', containsAiText: true,
    chatDocument: { requestId: 'save-turn', sections: [
      { heading: '书稿', text: draft },
      { heading: '留给爸爸的微信', text: wechat },
    ] },
  });
  const receipt = normalizeChatMessages(archiveMessagesFrom([result!.reply!], []), [])[0];
  expect(receipt.bookDocument).toEqual({ storyId, chapterId: 56, title: '车站的两把伞' });
});

it('asks for the exact material if one named section is unavailable or has competing final versions', async () => {
  const last = { ...turn('updated', draft, 'assistant'), ...bookChatReplyMetadata({ bookDraft: draft }, snapshot, storyId) };
  const create = vi.fn();
  const unspecified = await prepareBookTurn(turn('request-1', request), storyId, snapshot, [last], create);
  expect(unspecified?.reply?.content).toContain('具体原话');
  const competing = await prepareBookTurn(turn('request-2', request), storyId, snapshot,
    [last, turn('notes-1', notes), turn('notes-2', '留给爸爸的微信（定稿）：爸，我到站了。')], create);
  expect(competing?.reply?.content).toContain('具体原话');
  expect(create).not.toHaveBeenCalled();
});

it('works with a different title and section without binding to the example', async () => {
  const create = vi.fn(async () => ({ id: 42, title: '准备开会', storyId }));
  const exact = '  开会时间改到星期五。';
  const reply = await prepareBookTurn(turn('save', '帮我建一份叫《准备开会》的文档，把定好的发给同事的短信按原话保存'),
    storyId, snapshot, [turn('note', `发给同事的短信（已定稿）：「${exact}」`)], create);
  expect(create.mock.calls).toHaveLength(1);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({
    containsAiText: false, chatDocument: { requestId: 'save', sections: [{ heading: '发给同事的短信', text: exact }] },
  }));
  expect(reply?.reply?.bookDocument?.chapterId).toBe(42);
});


it('routes marked WeChat text as writing material while leaving explicit interface commands available', () => {
  expect(isBookWritingMaterialTurn(notes)).toBe(true);
  expect(isBookWritingMaterialTurn('帮我理一下')).toBe(true);
  expect(isBookWritingMaterialTurn('打开微信小程序')).toBe(false);
  expect(isBookWritingMaterialTurn('把这章发送给邮箱里的李同学')).toBe(false);
});


it('does not execute a document command quoted inside material', async () => {
  const create = vi.fn();
  const line = '我把她的话记在这里：“帮我建一份叫《随手记》的文档，把刚才的书稿按原话保存。”';
  expect(await prepareBookTurn(turn('quoted', line), storyId, snapshot, [], create)).toBeUndefined();
  expect(create).not.toHaveBeenCalled();
});
