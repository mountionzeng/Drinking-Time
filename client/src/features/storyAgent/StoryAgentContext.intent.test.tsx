import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { StoryIntent } from './intentTypes';

vi.stubGlobal('React', React);

const makeMutation = vi.hoisted(() => () => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      storyAgent: {
        storyList: { fetch: vi.fn(async () => ({ stories: [] })) },
        storyGet: { fetch: vi.fn(async () => null) },
        storyImages: { invalidate: vi.fn() },
        storyMaterialState: { invalidate: vi.fn() },
      },
      promptLineage: {
        getStoryProjection: {
          fetch: vi.fn(),
          invalidate: vi.fn(),
        },
      },
      shot: { list: { invalidate: vi.fn() } },
    }),
    storyAgent: {
      chat: { useMutation: makeMutation },
      uploadPhoto: { useMutation: makeMutation },
      recordSignal: { useMutation: makeMutation },
      classify: { useMutation: makeMutation },
      generateForMobile: { useMutation: makeMutation },
      recognizeIntent: { useMutation: makeMutation },
      storyUpsert: { useMutation: makeMutation },
      insertStoryShotAfter: { useMutation: makeMutation },
      storyDelete: { useMutation: makeMutation },
      selectionEdit: { useMutation: makeMutation },
    },
    creationAgent: {
      confirmTimelineTransition: { useMutation: makeMutation },
    },
    artAgent: {
      riff: { useMutation: makeMutation },
      analyzeReference: { useMutation: makeMutation },
    },
    editContext: {
      saveSnapshot: { useMutation: makeMutation },
    },
    promptLineage: {
      createCandidate: { useMutation: makeMutation },
      confirmCandidate: { useMutation: makeMutation },
      rejectCandidate: { useMutation: makeMutation },
    },
    storyConversation: {
      appendTurn: { useMutation: makeMutation },
      list: {
        useQuery: () => ({ data: undefined }),
      },
    },
  },
}));

const jobIntent: StoryIntent = {
  purpose: 'linkedin_job_search',
  audience: 'recruiters',
  platform: 'linkedin',
  tone: '清晰、专业',
  desiredEffect: '让招聘者看见竞争力',
  targetRole: '产品经理',
  channel: 'linkedin',
};

const fictionIntent: StoryIntent = {
  purpose: 'fiction',
  audience: 'public',
  platform: 'presentation',
  tone: '有世界感、有人物动机',
  desiredEffect: '把一句虚构灵感发展成一个能拍的短片故事',
};

describe('StoryAgentContext intent state', () => {
  it('exposes shared confirmedIntent state and controls from context', async () => {
    const { StoryAgentProvider, useStoryAgent } = await import('./StoryAgentContext');

    function Inspector() {
      const ctx = useStoryAgent();
      return (
        <pre>
          {JSON.stringify({
            confirmedIntent: ctx.confirmedIntent,
            canSet: typeof ctx.setConfirmedIntent === 'function',
            canClear: typeof ctx.clearIntent === 'function',
          })}
        </pre>
      );
    }

    const html = renderToStaticMarkup(
      <StoryAgentProvider projectId={null}>
        <Inspector />
      </StoryAgentProvider>,
    );

    expect(html).toContain('&quot;confirmedIntent&quot;:null');
    expect(html).toContain('&quot;canSet&quot;:true');
    expect(html).toContain('&quot;canClear&quot;:true');
  });

  it('resolves generateScript intent from context when no override is passed', async () => {
    const { resolveScriptIntent } = await import('./StoryAgentContext');

    expect(resolveScriptIntent(undefined, jobIntent)).toEqual(jobIntent);
  });

  it('builds the chat payload that carries confirmed job intent into storyAgent.chat', async () => {
    const { buildChatIntentPayload } = await import('./StoryAgentContext');

    expect(buildChatIntentPayload(jobIntent)).toEqual({
      purpose: 'linkedin_job_search',
      audience: 'recruiters',
      platform: 'linkedin',
      tone: '清晰、专业',
      desiredEffect: '让招聘者看见竞争力',
      targetRole: '产品经理',
      channel: 'linkedin',
    });
    expect(buildChatIntentPayload(null)).toBeUndefined();
  });

  it('builds the chat payload that carries a confirmed fiction intent into storyAgent.chat', async () => {
    const { buildChatIntentPayload } = await import('./StoryAgentContext');

    expect(buildChatIntentPayload(fictionIntent)).toEqual({
      purpose: 'fiction',
      audience: 'public',
      platform: 'presentation',
      tone: '有世界感、有人物动机',
      desiredEffect: '把一句虚构灵感发展成一个能拍的短片故事',
      targetRole: undefined,
      channel: undefined,
    });
  });

  it('normalizes the fiction intent label used by the opening menu', async () => {
    const { PURPOSE_LABELS, normalizeStoryIntent } = await import('./intentTypes');

    expect(PURPOSE_LABELS.fiction).toBe('创造另一个世界');
    expect(
      normalizeStoryIntent({
        ...fictionIntent,
        fictionStoryCardConfirmed: true,
        fictionStoryCardSignature: 'card-1:月亮掉进菜市场',
      }),
    ).toMatchObject({
      purpose: 'fiction',
      audience: 'public',
      platform: 'presentation',
      fictionStoryCardConfirmed: true,
      fictionStoryCardSignature: 'card-1:月亮掉进菜市场',
    });
  });

  it('tracks fiction story-card confirmation on the shared intent', async () => {
    const {
      confirmFictionStoryCardsForIntent,
      isFictionStoryCardConfirmed,
      clearFictionStoryCardConfirmation,
    } = await import('./StoryAgentContext');
    const cards = [
      { id: 'card-1', content: '月亮掉进菜市场' },
      { id: 'card-2', content: '修钟人想把夜晚调慢' },
    ];

    const confirmed = confirmFictionStoryCardsForIntent(fictionIntent, cards);

    expect(confirmed).toMatchObject({
      purpose: 'fiction',
      fictionStoryCardConfirmed: true,
    });
    expect(isFictionStoryCardConfirmed(confirmed, cards)).toBe(true);
    expect(
      isFictionStoryCardConfirmed(confirmed, [
        cards[0],
        { id: 'card-2', content: '修钟人想把夜晚调快' },
      ]),
    ).toBe(false);
    const cleared = clearFictionStoryCardConfirmation(confirmed);
    expect(cleared).toMatchObject({ purpose: 'fiction' });
    expect(cleared).not.toHaveProperty('fictionStoryCardConfirmed');
    expect(cleared).not.toHaveProperty('fictionStoryCardSignature');
  });

  it('normalizes and persists confirmed intent so loaded stories keep the job lane active', async () => {
    const { normalizeStoryIntent } = await import('./intentTypes');
    const { emptyState, normalizePersisted } = await import('./storyAgentPersistence');

    expect(
      normalizeStoryIntent({
        ...jobIntent,
        jobMaterialsPrompted: true,
        evidence: ['想做找工作的片子'],
      }),
    ).toMatchObject({
      ...jobIntent,
      jobMaterialsPrompted: true,
      evidence: ['想做找工作的片子'],
    });
    expect(normalizeStoryIntent({ purpose: 'linkedin_job_search' })).toBeNull();

    const persisted = normalizePersisted({
      ...emptyState(),
      confirmedIntent: { ...jobIntent, jobMaterialsPrompted: true },
    });

    expect(persisted.confirmedIntent).toMatchObject({
      purpose: 'linkedin_job_search',
      targetRole: '产品经理',
      channel: 'linkedin',
      jobMaterialsPrompted: true,
    });
  });

  it('lets an explicit generateScript argument override context intent for compatibility', async () => {
    const { resolveScriptIntent } = await import('./StoryAgentContext');
    const override: StoryIntent = {
      purpose: 'social_post',
      audience: 'friends',
      platform: 'wechat',
      tone: '轻松',
      desiredEffect: '发朋友圈',
    };

    expect(resolveScriptIntent(override, jobIntent)).toEqual(override);
  });

  it('returns undefined after intent is cleared so the opening menu may appear again', async () => {
    const { resolveScriptIntent } = await import('./StoryAgentContext');

    expect(resolveScriptIntent(undefined, null)).toBeUndefined();
  });

  it('prefers the first persisted story id over draft sentinels', async () => {
    const { resolvePersistedStoryId, storyScopeMatches } = await import('./StoryAgentContext');

    expect(resolvePersistedStoryId(-1, 36, 42)).toBe(36);
    expect(resolvePersistedStoryId(null, undefined, 42)).toBe(42);
    expect(resolvePersistedStoryId(-1, 0, null)).toBeNull();
    expect(storyScopeMatches(-1, -1)).toBe(true);
    expect(storyScopeMatches(36, 34)).toBe(false);
  });
});
