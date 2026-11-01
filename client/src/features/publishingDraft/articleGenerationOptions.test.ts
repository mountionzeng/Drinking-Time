import { describe, expect, it } from 'vitest';
import { articleGenerationInstruction, DEFAULT_ARTICLE_OPTIONS } from './articleGenerationOptions';
describe('article generation options', () => {
  it('keeps defaults grounded in conversation and current manuscript', () => {
    const instruction = articleGenerationInstruction(DEFAULT_ARTICLE_OPTIONS, '保留结尾');
    expect(instruction).toContain('不编造事实');
    expect(instruction).toContain('当前书稿');
    expect(instruction).toContain('保留结尾');
    expect(instruction).not.toContain('undefined');
    for (const text of ['优先沿用聊天中用户已明确的文章形式','优先沿用聊天中用户已明确的篇幅','受众、用途、语气和禁写范围','用户最新明确修正优先','助手建议或推测不作为用户事实']) expect(instruction).toContain(text);
  });
  it('sends form, factuality, length and user requirements to the existing version request', () => {
    const instruction = articleGenerationInstruction({nature:'factual',form:'letter',length:'short',requirements:'写给朋友，语气朴素'}, '不要添加新人物');
    for (const text of ['真实经历','书信','约 300 字','写给朋友，语气朴素','不要添加新人物','不凑字数']) expect(instruction).toContain(text);
  });
  it('allows invented material only when fiction is explicitly chosen', () => {
    const instruction = articleGenerationInstruction({...DEFAULT_ARTICLE_OPTIONS,nature:'fiction',form:'narrative'}, '');
    expect(instruction).toContain('虚构创作');
    expect(instruction).toContain('叙事文章');
  });
});
