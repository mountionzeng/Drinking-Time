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
      },
      shot: { list: { invalidate: vi.fn() } },
    }),
    storyAgent: {
      chat: { useMutation: makeMutation },
      uploadPhoto: { useMutation: makeMutation },
      recordSignal: { useMutation: makeMutation },
      classify: { useMutation: makeMutation },
      recognizeIntent: { useMutation: makeMutation },
      storyUpsert: { useMutation: makeMutation },
      storyDelete: { useMutation: makeMutation },
      selectionEdit: { useMutation: makeMutation },
    },
    artAgent: {
      riff: { useMutation: makeMutation },
      analyzeReference: { useMutation: makeMutation },
      generateCandidates: { useMutation: makeMutation },
    },
    editContext: {
      saveSnapshot: { useMutation: makeMutation },
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
});
