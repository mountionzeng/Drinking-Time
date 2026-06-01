import { describe, expect, it } from 'vitest';
import { buildReturningGreeting } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// 第二步：召回 + 记忆承诺 —— 老用户点回旧故事时小酌「我还记得上次……」再问候的文案契约。
// 守两件事：① honesty（R6/R13）——证明「记着」，但绝不承诺「永久/永远记住」；
//           ② 召回逻辑——有真实发言才召回、按 logline → 卡片原话 → 标题 优先级取材。
// ─────────────────────────────────────────────────────────────────────────────
describe('buildReturningGreeting (第二步：召回 + 记忆承诺)', () => {
  it('没有用户真实发言时返回 null（不对空故事硬造记忆）', () => {
    expect(
      buildReturningGreeting({
        hasPriorUserMessages: false,
        logline: '一段很完整的 logline',
        lastCardQuote: '某句原话',
        title: '某标题',
      }),
    ).toBeNull();
  });

  it('有 logline 时优先用 logline 召回，并把人接回这一篇', () => {
    const text = buildReturningGreeting({
      hasPriorUserMessages: true,
      logline: '那天加班到很晚，便利店阿姨多给了我一个茶叶蛋',
      lastCardQuote: '不该用的原话',
      title: '不该用的标题',
    });
    expect(text).not.toBeNull();
    expect(text).toContain('便利店阿姨多给了我一个茶叶蛋');
    expect(text).toContain('上次');
  });

  it('没有 logline 时退到最近一张卡片的原话', () => {
    const text = buildReturningGreeting({
      hasPriorUserMessages: true,
      logline: '   ',
      lastCardQuote: '她那句「下次再约」',
      title: '不该用的标题',
    });
    expect(text).toContain('她那句「下次再约」');
  });

  it('logline 与卡片原话都没有时退到标题', () => {
    const text = buildReturningGreeting({
      hasPriorUserMessages: true,
      lastCardQuote: '',
      title: '便利店的茶叶蛋',
    });
    expect(text).toContain('便利店的茶叶蛋');
  });

  it('什么素材都没有但有发言时，仍给一句温柔的兜底再问候', () => {
    const text = buildReturningGreeting({ hasPriorUserMessages: true });
    expect(text).not.toBeNull();
    expect(text).toContain('上次');
  });

  it('过长的 logline 会被截断，避免气泡里塞一整段', () => {
    const longLogline = '很长的句子'.repeat(30);
    const text = buildReturningGreeting({
      hasPriorUserMessages: true,
      logline: longLogline,
    });
    expect(text).not.toBeNull();
    expect(text).toContain('…');
    // 截断后整句不该把原始 logline 全量塞进来
    expect((text as string).length).toBeLessThan(longLogline.length);
  });

  it('任何分支都不得过度承诺永久记忆 (R6, R13)', () => {
    const variants = [
      buildReturningGreeting({ hasPriorUserMessages: true, logline: '有 logline' }),
      buildReturningGreeting({ hasPriorUserMessages: true, lastCardQuote: '有原话' }),
      buildReturningGreeting({ hasPriorUserMessages: true, title: '有标题' }),
      buildReturningGreeting({ hasPriorUserMessages: true }),
    ];
    for (const text of variants) {
      expect(text).not.toBeNull();
      const t = text as string;
      expect(t).not.toContain('永久');
      expect(t).not.toContain('永远记得');
      expect(t).not.toContain('永远记住');
      expect(t).not.toContain('都会记住');
      // 也不该回到「采样器」人设
      expect(t).not.toContain('收集');
      expect(t).not.toContain('采样');
      // 但必须真的表达出「记着 / 还在」这层召回感，否则失去记忆承诺的意义
      expect(/记|留着|还在/.test(t)).toBe(true);
    }
  });
});
