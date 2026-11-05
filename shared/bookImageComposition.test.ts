import { describe, expect, it } from 'vitest';
import { compositionSources, compositionReferences, compositionPrompt, compositionQuote, isBookImageCreationIntent } from './bookImageComposition';
const sources = [{id:'i',text:'![图片](/api/images/teapot.png)'},{id:'t',text:'茶壶从白屏蹦出，保留手绘线条'}];
describe('book image composition', () => {
  it('keeps document order and ignores blank modules without dropping text', () => {
    expect(compositionSources([...sources,{id:'blank',text:''}], ['t','blank','i'])).toEqual(sources);
    expect(compositionSources(sources)).toEqual(sources);
    expect(() => compositionSources(sources,['missing'])).toThrow('变化');
  });
  it('uses the latest result first while retaining original references and every instruction', () => {
    expect(compositionReferences(sources,'/new.png')).toEqual(['/new.png','/api/images/teapot.png']);
    const prompt=compositionPrompt(sources,['保留网页文字','去掉阴影'],true);
    for(const text of ['图1是上一轮结果','保留网页文字','去掉阴影','茶壶从白屏']) expect(prompt).toContain(text);
    expect(compositionQuote(sources,['去掉阴影'],true)).toBeGreaterThan(compositionQuote(sources,[],false));
  });
  it.each(['帮我生成一张图','把这些模块合并为图像','画一张图片','create an image'])('recognizes explicit creation: %s', text=>expect(isBookImageCreationIntent(text)).toBe(true));
  it.each(['不要生成一张图','我不需要生成图片','这个图片是什么意思','图片生成模型多少钱'])('keeps ordinary or negative discussion: %s', text=>expect(isBookImageCreationIntent(text)).toBe(false));
});
