import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from './types';
import type { StoryIntent } from './intentTypes';

vi.stubGlobal('React', React);

const fixtures = vi.hoisted(() => {
  const openingMessage: ChatMessage = {
    id: 'first-question',
    role: 'assistant',
    content: '你好，我是小酌。',
    timestamp: 1,
  };
  const jobIntent: StoryIntent = {
    purpose: 'linkedin_job_search',
    audience: 'recruiters',
    platform: 'linkedin',
    desiredEffect: '让招聘者看见竞争力',
    tone: '清晰、专业',
    confidence: 0.72,
    missingQuestion: '',
  };
  return {
    openingMessage,
    jobIntent,
    chatContextState: {
      messages: [
        openingMessage,
        { id: 'user-1', role: 'user' as const, content: '想做找工作的片子', timestamp: 2 },
      ],
      cards: [],
      isReplying: false,
      sendMessage: vi.fn(),
      resetConversation: vi.fn(),
      backToList: vi.fn(),
      activeStoryId: -1,
      remoteStoryId: undefined as number | undefined,
      saveStatus: 'idle',
      lastSavedAt: undefined as number | undefined,
      returningGreeting: null as string | null,
      confirmedIntent: null as StoryIntent | null,
      pendingIntentDraft: jobIntent as StoryIntent | null,
      confirmPendingIntent: vi.fn(),
      dismissPendingIntent: vi.fn(),
      activeSelection: null,
      clearSelection: vi.fn(),
      sendSelectionEdit: vi.fn(),
    },
  };
});

describe('StoryAgentContext background intent recognition', () => {
  it('triggers only for the first real user message when no intent exists', async () => {
    const { shouldTriggerIntentRecognition } = await import('./StoryAgentContext');

    expect(
      shouldTriggerIntentRecognition({
        messages: [fixtures.openingMessage],
        confirmedIntent: null,
        pendingIntentDraft: null,
      }),
    ).toBe(true);

    expect(
      shouldTriggerIntentRecognition({
        messages: [
          fixtures.openingMessage,
          { id: 'user-1', role: 'user', content: '我想做找工作的片子', timestamp: 2 },
        ],
        confirmedIntent: null,
        pendingIntentDraft: null,
      }),
    ).toBe(false);
  });

  it('does not trigger after menu confirmation or while a soft-confirm draft exists', async () => {
    const { shouldTriggerIntentRecognition } = await import('./StoryAgentContext');

    expect(
      shouldTriggerIntentRecognition({
        messages: [fixtures.openingMessage],
        confirmedIntent: fixtures.jobIntent,
        pendingIntentDraft: null,
      }),
    ).toBe(false);
    expect(
      shouldTriggerIntentRecognition({
        messages: [fixtures.openingMessage],
        confirmedIntent: null,
        pendingIntentDraft: fixtures.jobIntent,
      }),
    ).toBe(false);
  });

  it('turns high-confidence job-search recognition into a soft-confirm draft', async () => {
    const { recognitionToPendingJobIntent } = await import('./StoryAgentContext');

    expect(recognitionToPendingJobIntent(fixtures.jobIntent)).toEqual(fixtures.jobIntent);
  });

  it('stays quiet for low-confidence or non-job recognition', async () => {
    const { recognitionToPendingJobIntent } = await import('./StoryAgentContext');

    expect(
      recognitionToPendingJobIntent({
        ...fixtures.jobIntent,
        confidence: 0.59,
      }),
    ).toBeNull();
    expect(
      recognitionToPendingJobIntent({
        ...fixtures.jobIntent,
        purpose: 'exploration',
        confidence: 0.95,
      }),
    ).toBeNull();
  });

  it('logs recognition failures without throwing into the chat flow', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { warnIntentRecognitionError } = await import('./StoryAgentContext');

    warnIntentRecognitionError(new Error('network down'));

    expect(warnSpy).toHaveBeenCalledWith(
      '[storyAgent.intent] recognizeIntent failed:',
      'network down',
    );
    warnSpy.mockRestore();
  });
});

vi.mock('@/features/storyAgent/StoryAgentContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./StoryAgentContext')>();
  return {
    ...actual,
    useStoryAgent: () => fixtures.chatContextState,
  };
});

vi.mock('@/features/nayin/NayinContext', () => ({
  useNayin: () => ({ element: 'fire' }),
}));

vi.mock('@/features/nayin/views/EmotiveWuxingIcon', () => ({
  default: () => <span data-testid="wuxing-icon" />,
}));

vi.mock('@/features/storyAgent/hooks/useVoiceInput', () => ({
  useVoiceInput: () => ({
    isBusy: false,
    isRecording: false,
    isTranscribing: false,
    toggleRecording: vi.fn(),
  }),
}));

vi.mock('./views/StoryArtDirectionLauncher', () => ({
  default: () => null,
}));

describe('StoryAgentChat intent soft confirm', () => {
  beforeEach(() => {
    fixtures.chatContextState.pendingIntentDraft = fixtures.jobIntent;
    fixtures.chatContextState.confirmedIntent = null;
    fixtures.chatContextState.isReplying = false;
  });

  it('renders the reflect-back bubble when a pending job intent exists', async () => {
    const { default: StoryAgentChat } = await import('./views/StoryAgentChat');

    const html = renderToStaticMarkup(<StoryAgentChat />);

    expect(html).toContain('听起来你是想做求职片');
    expect(html).toContain('对，按求职片来');
    expect(html).toContain('先不，继续聊');
  });

  it('does not render the bubble while the assistant is replying', async () => {
    fixtures.chatContextState.isReplying = true;
    const { default: StoryAgentChat } = await import('./views/StoryAgentChat');

    expect(renderToStaticMarkup(<StoryAgentChat />)).not.toContain('听起来你是想做求职片');
  });
});
