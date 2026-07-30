import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@/features/storyAgent/types';
import type { StoryIntent } from '../intentTypes';

vi.stubGlobal('React', React);

const contextState = vi.hoisted(() => ({
  setConfirmedIntent: vi.fn(),
}));

vi.mock('@/features/storyAgent/StoryAgentContext', () => ({
  useStoryAgent: () => contextState,
  useStoryAgentActions: () => contextState,
}));

const openingMessage: ChatMessage = {
  id: 'first-question',
  role: 'assistant',
  content: '你好，我是小酌。',
  timestamp: 1,
};

describe('StoryCapabilityMenu', () => {
  it('renders the opening capabilities and the direct-speech escape hatch', async () => {
    const { default: StoryCapabilityMenu } = await import('./StoryCapabilityMenu');

    const html = renderToStaticMarkup(<StoryCapabilityMenu />);

    expect(html).toContain('经历或灵感');
    expect(html).toContain('记录');
    expect(html).toContain('给自己留念');
    expect(html).toContain('给别人讲个故事');
    expect(html).toContain('父母给孩子讲故事');
    expect(html).toContain('发社交平台给陌生人');
    expect(html).toContain('生成一个自己的故事');
    expect(html).toContain('生成求职视频');
    expect(html).toContain('介绍自己的经历');
    expect(html).toContain('创造另一个世界');
    expect(html).toContain('虚构短片故事');
    expect(html).toContain('直接说你的事');
  });

  it('selecting job search confirms the shared intent and leaves intake fields empty for U3', async () => {
    const { chooseCapability } = await import('./StoryCapabilityMenu');
    const setConfirmedIntent = vi.fn();

    const intent = chooseCapability('linkedin_job_search', setConfirmedIntent);

    expect(setConfirmedIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'linkedin_job_search',
        audience: 'recruiters',
        platform: 'linkedin',
      }),
    );
    expect(intent.targetRole).toBeUndefined();
    expect(intent.channel).toBeUndefined();
  });

  it('selecting a social post confirms a non-job intent without entering the job lane', async () => {
    const { chooseCapability } = await import('./StoryCapabilityMenu');
    const setConfirmedIntent = vi.fn();

    const intent = chooseCapability('social_post', setConfirmedIntent);

    expect(intent.purpose).toBe('social_post');
    expect(intent.purpose).not.toBe('linkedin_job_search');
    expect(setConfirmedIntent).toHaveBeenCalledWith(intent);
  });

  it('maps the parent-to-child lane to a private specific-person story', async () => {
    const { chooseCapability } = await import('./StoryCapabilityMenu');
    const intent = chooseCapability('gift', vi.fn());

    expect(intent).toMatchObject({
      purpose: 'gift',
      audience: 'specific_person',
      platform: 'private_archive',
      desiredEffect: expect.stringContaining('父母'),
    });
  });

  it('maps the personal-experience lane to a public story about the user', async () => {
    const { chooseCapability } = await import('./StoryCapabilityMenu');
    const intent = chooseCapability('portfolio', vi.fn());

    expect(intent).toMatchObject({
      purpose: 'portfolio',
      audience: 'public',
      platform: 'presentation',
      desiredEffect: expect.stringContaining('真实经历'),
    });
  });

  it('selecting fiction confirms a world-building story intent without entering the job lane', async () => {
    const { chooseCapability } = await import('./StoryCapabilityMenu');
    const setConfirmedIntent = vi.fn();

    const intent = chooseCapability('fiction', setConfirmedIntent);

    expect(setConfirmedIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'fiction',
        audience: 'public',
        platform: 'presentation',
        desiredEffect: expect.stringContaining('虚构灵感'),
      }),
    );
    expect(intent.targetRole).toBeUndefined();
    expect(intent.channel).toBeUndefined();
    expect(intent.jobMaterialsPrompted).toBeUndefined();
  });

  it('hides once an intent already exists', async () => {
    const { shouldShowCapabilityMenu } = await import('./StoryCapabilityMenu');
    const confirmedIntent: StoryIntent = {
      purpose: 'personal_memory',
      audience: 'self',
      platform: 'private_archive',
    };

    expect(
      shouldShowCapabilityMenu({
        messages: [openingMessage],
        confirmedIntent,
        returningGreeting: null,
        isReplying: false,
      }),
    ).toBe(false);
  });

  it('does not append chat messages when a menu option is selected', async () => {
    const { chooseCapability } = await import('./StoryCapabilityMenu');
    const messages = [openingMessage];

    chooseCapability('linkedin_job_search', vi.fn());

    expect(messages).toEqual([openingMessage]);
  });

  it('shows for an opening assistant message but not after the user starts talking', async () => {
    const { shouldShowCapabilityMenu } = await import('./StoryCapabilityMenu');

    expect(
      shouldShowCapabilityMenu({
        messages: [openingMessage],
        confirmedIntent: null,
        returningGreeting: null,
        isReplying: false,
      }),
    ).toBe(true);

    expect(
      shouldShowCapabilityMenu({
        messages: [
          openingMessage,
          { id: 'user-1', role: 'user', content: '想做找工作的片子', timestamp: 2 },
        ],
        confirmedIntent: null,
        returningGreeting: null,
        isReplying: false,
      }),
    ).toBe(false);
  });
});
