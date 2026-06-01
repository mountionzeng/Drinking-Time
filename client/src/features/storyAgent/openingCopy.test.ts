import { describe, expect, it } from 'vitest';
import { FIRST_QUESTION, OPENING_PREAMBLE, OPENING_MESSAGE } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// U4：桌面开场「报到 + 人格 + 定位」文案契约（R4, R5, R6, R13）
// D4「前缀 preamble」策略：preamble 在前报到 + 立人格，FIRST_QUESTION 原文收尾邀请。
// 结构化断言文案硬约束；定位（AE2）与浏览器实测（AE1/AE3）行为类移交 U5 rubric。
// ─────────────────────────────────────────────────────────────────────────────
describe('storyAgent 桌面开场文案 (U4：报到 + 人格 + 定位)', () => {
  it('开场消息有报到 + 朋友/助手身份，落点是邀请说一件小事 (AE1, R4)', () => {
    // 报到：一进门点名自己是谁
    expect(OPENING_MESSAGE).toContain('你好，我是小酌');
    // 人格：朋友 + 助手双重身份点明（参照「记得你的调酒师」气质）
    expect(OPENING_MESSAGE).toContain('朋友');
    expect(OPENING_MESSAGE).toContain('助手');
    // 落点：以 FIRST_QUESTION 的邀请收尾（说一件很小的事）
    expect(OPENING_MESSAGE).toContain('一件今天的小事');
    expect(OPENING_MESSAGE).toContain(FIRST_QUESTION);
  });

  it('开场文案不含「收集 / 采样」字样 (R4，避免回到取样器人设)', () => {
    expect(OPENING_MESSAGE).not.toContain('收集');
    expect(OPENING_MESSAGE).not.toContain('采样');
  });

  it('开场文案无永久记忆等过度承诺 (AE3, R6, R13)', () => {
    // 第一步不承诺永久记忆（也不否认将来会有，为第二步 DATABASE_URL 留接口）
    expect(OPENING_MESSAGE).not.toContain('永久');
    expect(OPENING_MESSAGE).not.toContain('永远记得');
    expect(OPENING_MESSAGE).not.toContain('永远记住');
    expect(OPENING_MESSAGE).not.toContain('都会记住');
  });

  it('FIRST_QUESTION 文本保持不变，且为开场消息的收尾 (D4 回归守卫)', () => {
    // 回归守卫：FIRST_QUESTION 必须与服务端 server/archive/storyAgent.ts L20、
    // 手机端 MobileChatContext 三处保持一致；改这里前请同步三处，否则文案漂移。
    expect(FIRST_QUESTION).toBe(
      '今天有没有一件很小的事，在你心里留下了一点感觉？不用重要，随便说。',
    );
    // D4 前缀策略：preamble 只做前缀，FIRST_QUESTION 原文一字不动地收尾
    expect(OPENING_MESSAGE.endsWith(FIRST_QUESTION)).toBe(true);
    expect(OPENING_MESSAGE.startsWith(OPENING_PREAMBLE)).toBe(true);
  });
});
