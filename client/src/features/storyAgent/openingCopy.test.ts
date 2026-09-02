import { describe, expect, it } from 'vitest';
import {
  displayAssistantName,
  FIRST_QUESTION,
  isOpeningChatMessage,
  OPENING_MESSAGE,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// 桌面开场文案契约。
// 原先是「报到 + 人格 + 定位」的 preamble 前缀策略（U4 / D4）；现在开场只保留
// FIRST_QUESTION 一句邀请，自我介绍那段已移除——一进门先讲自己是谁会占掉整屏第一眼，
// 而这些信息页面别处已经给过。R4/R6/R13 的负向约束（不做取样器人设、不承诺永久记忆）继续守。
// ─────────────────────────────────────────────────────────────────────────────
describe('storyAgent 桌面开场文案', () => {
  it('开场就是那句邀请，不再有自我介绍前缀', () => {
    expect(OPENING_MESSAGE).toBe(FIRST_QUESTION);
    expect(OPENING_MESSAGE).not.toContain('你好，我是');
    expect(OPENING_MESSAGE).not.toContain('助手');
  });

  it('开场文案不含「收集 / 采样」字样 (R4，避免回到取样器人设)', () => {
    expect(OPENING_MESSAGE).not.toContain('收集');
    expect(OPENING_MESSAGE).not.toContain('采样');
  });

  it('开场文案无永久记忆等过度承诺 (AE3, R6, R13)', () => {
    expect(OPENING_MESSAGE).not.toContain('永久');
    expect(OPENING_MESSAGE).not.toContain('永远记得');
    expect(OPENING_MESSAGE).not.toContain('永远记住');
    expect(OPENING_MESSAGE).not.toContain('都会记住');
  });

  it('FIRST_QUESTION 文本保持不变 (D4 回归守卫)', () => {
    // 回归守卫：FIRST_QUESTION 必须与服务端 server/archive/storyAgent.prompts.ts 保持一致，
    // 改这里前请同步，否则文案漂移。
    expect(FIRST_QUESTION).toBe(
      '今天有没有一件很小的事，在你心里留下了一点感觉？不用重要，随便说。',
    );
  });

  it('旧故事里带自我介绍前缀的开场仍会被识别，并只以新名称展示', () => {
    const legacyOpening = `你好，我是小酌——会听你说话的朋友。\n\n${FIRST_QUESTION}`;

    expect(
      isOpeningChatMessage({ id: 'legacy-opening', content: legacyOpening }),
    ).toBe(true);
    expect(displayAssistantName(legacyOpening)).toContain('你好，我是聊聊');
    expect(displayAssistantName(legacyOpening)).not.toContain('小酌');
  });

  it('去掉前缀后的新开场也算开场消息（避免被当成用户的第一句话）', () => {
    expect(
      isOpeningChatMessage({ id: 'new-opening', content: OPENING_MESSAGE }),
    ).toBe(true);
  });
});
