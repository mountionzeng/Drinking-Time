import { describe, expect, it } from 'vitest';
import { resolveEmotionMood } from '@/features/nayin/views/EmotiveWuxingIcon';

describe('resolveEmotionMood', () => {
  it('空值与「未标」回到待机', () => {
    expect(resolveEmotionMood(undefined)).toBe('neutral');
    expect(resolveEmotionMood(null)).toBe('neutral');
    expect(resolveEmotionMood('')).toBe('neutral');
    expect(resolveEmotionMood('  ')).toBe('neutral');
    expect(resolveEmotionMood('未标')).toBe('neutral');
  });

  it('子类中文名归到所属大类姿势', () => {
    expect(resolveEmotionMood('狂喜')).toBe('joy');
    expect(resolveEmotionMood('焦虑')).toBe('fear');
    expect(resolveEmotionMood('怀念')).toBe('sadness');
  });

  it('英文 key 同样可用', () => {
    expect(resolveEmotionMood('ecstasy')).toBe('joy');
    expect(resolveEmotionMood('nostalgia')).toBe('sadness');
    expect(resolveEmotionMood('curiosity')).toBe('anticipation');
    expect(resolveEmotionMood('clarity')).toBe('groundedness');
  });

  it('混合情绪取第一成分的姿势', () => {
    expect(resolveEmotionMood('love')).toBe('joy');
  });

  it('口语变体也能识别', () => {
    expect(resolveEmotionMood('高兴疯了')).toBe('joy');
  });

  it('长文本里包含已知标签时模糊命中', () => {
    expect(resolveEmotionMood('整个人都在发光啊')).toBe('joy');
  });

  it('单字大类兜底', () => {
    expect(resolveEmotionMood('微惊')).toBe('surprise');
  });

  it('完全不认识的文字回到待机', () => {
    expect(resolveEmotionMood('蓝色窗帘')).toBe('neutral');
  });
});
