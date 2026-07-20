import { describe, expect, it } from 'vitest';
import {
  OPENING_MESSAGE,
  normalizeChatMessages,
  type ChatMessage,
} from './types';

describe('storyAgent photo messages', () => {
  const fallbackMessages: ChatMessage[] = [
    {
      id: 'first-q',
      role: 'assistant',
      content: '开场白',
      timestamp: 1,
    },
  ];

  it('恢复消息时保留用户照片 URL，即使文字为空也不丢消息', () => {
    const messages = normalizeChatMessages(
      [
        {
          who: 'u',
          text: '',
          photoUrl: 'https://example.com/photo.jpg',
        },
      ],
      fallbackMessages,
    );

    expect(messages).toEqual([
      expect.objectContaining({
        role: 'user',
        content: '',
        photoUrl: 'https://example.com/photo.jpg',
      }),
    ]);
  });

  it('忽略结构不完整的历史选区，避免引用卡渲染崩溃', () => {
    const [message] = normalizeChatMessages(
      [
        {
          who: 'u',
          text: '继续修改',
          selectionQuote: { sourceType: 'shot' },
        },
      ],
      fallbackMessages,
    );

    expect(message.selectionQuote).toBeUndefined();
  });

  it.each(['s', 'a'])('兼容旧故事里的助手角色 %s', (who) => {
    const messages = normalizeChatMessages(
      [
        {
          who,
          text: '我记得这张图属于第三幕。',
          timestamp: 2,
        },
      ],
      fallbackMessages,
    );

    expect(messages).toEqual([
      expect.objectContaining({
        role: 'assistant',
        content: '我记得这张图属于第三幕。',
      }),
    ]);
  });

  it('折叠迁移污染产生的同时间重复开场白', () => {
    const messages = normalizeChatMessages(
      [
        {
          id: 'opening-1',
          who: 's',
          text: OPENING_MESSAGE,
          timestamp: 10,
        },
        {
          id: 'opening-2',
          who: 'u',
          text: OPENING_MESSAGE,
          timestamp: 10,
        },
        {
          id: 'user-1',
          who: 'u',
          text: '继续看 0301',
          timestamp: 11,
        },
      ],
      fallbackMessages,
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      content: OPENING_MESSAGE,
    });
    expect(messages[1]).toMatchObject({
      role: 'user',
      content: '继续看 0301',
    });
  });
});
