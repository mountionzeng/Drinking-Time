import { describe, expect, it } from 'vitest';
import { normalizeChatMessages, type ChatMessage } from './types';

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
});
