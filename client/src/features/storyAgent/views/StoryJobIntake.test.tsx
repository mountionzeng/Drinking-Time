import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryIntent } from '../intentTypes';

vi.stubGlobal('React', React);

const contextState = vi.hoisted(() => ({
  confirmedIntent: null as StoryIntent | null,
  setConfirmedIntent: vi.fn(),
}));

vi.mock('@/features/storyAgent/StoryAgentContext', () => ({
  useStoryAgent: () => contextState,
  useStoryAgentActions: () => contextState,
}));

vi.mock('@/features/storyAgent/spine/selectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../spine/selectors')>();
  return {
    ...actual,
    useConfirmedIntent: () => contextState.confirmedIntent,
  };
});

const baseJobIntent: StoryIntent = {
  purpose: 'linkedin_job_search',
  audience: 'recruiters',
  platform: 'linkedin',
  tone: '清晰、专业',
  desiredEffect: '让招聘者看见竞争力',
};

beforeEach(() => {
  contextState.confirmedIntent = null;
  contextState.setConfirmedIntent.mockReset();
});

describe('StoryJobIntakePrompt', () => {
  it('asks for target role first after job-search intent is confirmed', async () => {
    contextState.confirmedIntent = baseJobIntent;
    const { default: StoryJobIntakePrompt } = await import('./StoryJobIntakePrompt');

    const html = renderToStaticMarkup(<StoryJobIntakePrompt />);

    expect(html).toContain('目标岗位或行业');
    expect(html).toContain('比如 产品经理');
    expect(html).not.toContain('主要准备投到哪里');
  });

  it('asks for channel after target role has been answered', async () => {
    contextState.confirmedIntent = { ...baseJobIntent, targetRole: '产品经理' };
    const { default: StoryJobIntakePrompt } = await import('./StoryJobIntakePrompt');

    const html = renderToStaticMarkup(<StoryJobIntakePrompt />);

    expect(html).toContain('主要准备投到哪里');
    expect(html).toContain('可以多选');
    expect(html).toContain('LinkedIn / 领英');
    expect(html).toContain('简历附件');
  });

  it('asks for JD or resume after target role and channel have been answered', async () => {
    contextState.confirmedIntent = {
      ...baseJobIntent,
      targetRole: '产品经理',
      channel: 'linkedin',
    };
    const { default: StoryJobIntakePrompt } = await import('./StoryJobIntakePrompt');

    const html = renderToStaticMarkup(<StoryJobIntakePrompt />);

    expect(html).toContain('JD 或简历');
    expect(html).toContain('招聘者视角');
    expect(html).toContain('好，我贴 JD / 简历');
  });

  it('hides after the JD/resume prompt has been acknowledged', async () => {
    contextState.confirmedIntent = {
      ...baseJobIntent,
      targetRole: '产品经理',
      channel: 'linkedin',
      jobMaterialsPrompted: true,
    };
    const { default: StoryJobIntakePrompt } = await import('./StoryJobIntakePrompt');

    expect(renderToStaticMarkup(<StoryJobIntakePrompt />)).toBe('');
  });

  it('fills both lightweight fields while preserving the job-search intent', async () => {
    const { getJobIntakeStep, mergeJobIntentField } = await import('./StoryJobIntakePrompt');

    const withRole = mergeJobIntentField(baseJobIntent, { targetRole: '产品经理' });
    const withChannel = mergeJobIntentField(withRole, { channel: 'linkedin,resume_attachment' });

    expect(withChannel).toMatchObject({
      purpose: 'linkedin_job_search',
      targetRole: '产品经理',
      channel: 'linkedin,resume_attachment',
    });
    expect(getJobIntakeStep(withChannel)).toBe('materials');
    expect(getJobIntakeStep(mergeJobIntentField(withChannel, { jobMaterialsPrompted: true }))).toBe('done');
  });

  it('supports multiple resume delivery channels before confirming the channel step', async () => {
    const { splitJobChannels, toggleJobChannel, joinJobChannels } = await import('./StoryJobIntakePrompt');

    const selected = toggleJobChannel(
      toggleJobChannel(splitJobChannels('linkedin'), 'resume_attachment'),
      'referral',
    );

    expect(selected).toEqual(['linkedin', 'resume_attachment', 'referral']);
    expect(toggleJobChannel(selected, 'linkedin')).toEqual(['resume_attachment', 'referral']);
    expect(joinJobChannels(selected, '官网申请')).toBe('linkedin,resume_attachment,referral,官网申请');
  });

  it('allows skipping both questions without blocking the job-search flow', async () => {
    const { getJobIntakeStep, mergeJobIntentField } = await import('./StoryJobIntakePrompt');

    const skippedRole = mergeJobIntentField(baseJobIntent, { targetRole: '' });
    const skippedBoth = mergeJobIntentField(skippedRole, { channel: '' });

    expect(skippedBoth.purpose).toBe('linkedin_job_search');
    expect(skippedBoth.targetRole).toBe('');
    expect(skippedBoth.channel).toBe('');
    expect(getJobIntakeStep(skippedBoth)).toBe('materials');
  });

  it('keeps the unanswered field empty when only one answer is provided', async () => {
    const { getJobIntakeStep, mergeJobIntentField } = await import('./StoryJobIntakePrompt');

    const withRoleOnly = mergeJobIntentField(baseJobIntent, { targetRole: '影视美术' });

    expect(withRoleOnly.targetRole).toBe('影视美术');
    expect(withRoleOnly.channel).toBeUndefined();
    expect(getJobIntakeStep(withRoleOnly)).toBe('channel');
  });
});
