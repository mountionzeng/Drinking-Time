import { describe, expect, it } from 'vitest';
import type { StoryIntent } from '@/features/storyAgent/intentTypes';
import { buildNarrativeJob, deriveNarrativeIntent } from './narrativeJob';

const jobSearchIntent: StoryIntent = {
  purpose: 'linkedin_job_search',
  audience: 'recruiters',
  platform: 'linkedin',
  tone: 'credible',
  desiredEffect: '让招聘者相信我能胜任跨学科创新岗位',
  targetRole: '跨学科创新力岗位',
  channel: 'conversation',
  confidence: 0.82,
};

describe('buildNarrativeJob', () => {
  it('does not create a narrative job for pure memory intent', () => {
    const memoryIntent: StoryIntent = {
      purpose: 'personal_memory',
      audience: 'self',
      platform: 'private',
      tone: 'warm',
      desiredEffect: '留下纪念',
      channel: 'conversation',
      confidence: 0.9,
    };

    expect(buildNarrativeJob({
      intent: memoryIntent,
      card: { title: '旧门口', content: '站在门口', emotion: '安静', sensoryDetails: [] },
      shotNo: 1,
      totalShots: 3,
    })).toBeUndefined();
  });

  it('turns a job-search intent into a visual explanation job', () => {
    const job = buildNarrativeJob({
      intent: jobSearchIntent,
      card: {
        title: '屏幕上的项目',
        content: '屏幕上密密麻麻的项目名、技能栏、数字',
        emotion: '紧张但清醒',
        sensoryDetails: ['冷调', '文字的堆叠感'],
      },
      shotNo: 2,
      totalShots: 4,
    });

    expect(job).toMatchObject({
      audience: '招聘者',
      evidence: expect.stringContaining('屏幕上密密麻麻的项目名'),
      claim: expect.stringContaining('跨学科转译能力'),
      roleConcern: expect.stringContaining('跨语境协作'),
      causalExplanation: expect.stringContaining('长期同时处理技术'),
      visualTranslation: expect.stringContaining('广告片导演'),
      externalValue: expect.stringContaining('翻译损耗'),
      recommendationStatus: expect.stringContaining('强证据'),
      avoidMisread: expect.stringContaining('求职说服力'),
    });
  });
});

describe('deriveNarrativeIntent', () => {
  it('keeps an explicitly confirmed intent', () => {
    expect(deriveNarrativeIntent({
      confirmedIntent: jobSearchIntent,
      cards: [],
    })).toBe(jobSearchIntent);
  });

  it('infers job-search intent from old story card materials', () => {
    const intent = deriveNarrativeIntent({
      confirmedIntent: null,
      cards: [
        {
          title: '跨学科创新力 擅长将技术创新…',
          content: '一份完整的简历，技术+艺术双背景，想转型但没说清楚方向。',
          sourceQuote: '跨学科创新力 擅长将技术创新转化为艺术生产力',
          rawText: '工作经历 技术创新 自主开发插件 效率提升300%',
        },
        {
          title: 'AIGC类 PM 岗位',
          content: '对方连说两遍 AIGC 类 PM 岗位。',
          sourceQuote: 'AIGC类 PM 岗位',
          rawText: 'AIGC类 PM 岗位',
        },
      ],
    });

    expect(intent).toMatchObject({
      purpose: 'linkedin_job_search',
      audience: 'recruiters',
      targetRole: 'AIGC PM',
      channel: 'story-material-inference',
    });
  });

  it('does not infer narrative intent from ordinary memory cards', () => {
    expect(deriveNarrativeIntent({
      confirmedIntent: null,
      cards: [
        {
          title: '夜市',
          content: '两位老同事隔了很久再见面。',
          sourceQuote: '你们多久没见了',
          rawText: '逛夜市，聊近况',
        },
      ],
    })).toBeNull();
  });
});
