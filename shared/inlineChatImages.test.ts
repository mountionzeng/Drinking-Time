import { expect, it } from 'vitest';
import { inlineImageToken as t, inlineChatImageIds, inlineChatInstruction } from './inlineChatImages';
it('keeps interleaved text and repeat mentions while numbering images by first occurrence', () => {
  const text = `取${t(2110)}的云，放到${t(2109)}里，保留${t(2110)}的亮度`;
  expect(inlineChatImageIds(text)).toEqual([2110, 2109]);
  expect(inlineChatInstruction(text)).toBe('取图1（图片 #2110）的云，放到图2（图片 #2109）里，保留图1（图片 #2110）的亮度');
});
it('rejects invalid and excess references instead of silently dropping them', () => {
  for (const text of ['[[ref:image%3A0]]', '[[ref:other%3A2]]', '[[ref:%zz]]', [1,2,3,4,5].map(t).join('')])
    expect(() => inlineChatImageIds(text)).toThrow();
  expect(inlineChatImageIds([1,1,1,1,1].map(t).join(''))).toEqual([1]);
});
