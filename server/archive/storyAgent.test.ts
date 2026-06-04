/**
 * Tests for U6: edit context injection into storyAgent system prompt
 *
 * These tests verify that:
 * - formatEditContextBlock returns empty string when no annotations
 * - formatEditContextBlock formats facts and preferences correctly
 * - Token budget truncation works
 * - replyFromStoryAgent fetches annotations when projectId provided
 * - Annotation fetch failure doesn't block Agent generation
 * - No annotations (cold start) → vanilla prompt (no edit context block)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../services/editContext', () => ({
  getRecentAnnotations: vi.fn(),
}));

vi.mock('../_core/llm', () => ({
  invokeLLM: vi.fn(),
}));

vi.mock('../_core/env', () => ({
  ENV: {
    forgeApiKey: 'test-key',
    forgeApiUrl: 'http://mock',
    llmModel: 'mock-model',
    ccApiKey: undefined,
    ccApiUrl: undefined,
    ccModel: undefined,
  },
}));

import { getRecentAnnotations } from '../services/editContext';
import { invokeLLM } from '../_core/llm';
import { replyFromStoryAgent, asEmotionOptions } from './storyAgent';
import type { SemanticAnnotation } from '../db';

const mockGetRecentAnnotations = vi.mocked(getRecentAnnotations);
const mockInvokeLLM = vi.mocked(invokeLLM);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAnnotation(
  factualChanges: string[],
  inferredPreferences: string[],
  status: 'active' | 'pending' | 'archived' = 'active',
): SemanticAnnotation {
  return {
    id: 1,
    snapshotId: 10,
    previousSnapshotId: null,
    factualChanges: JSON.stringify(factualChanges),
    inferredPreferences: JSON.stringify(inferredPreferences),
    timestamp: new Date(),
    status,
  };
}

function makeAgentResponse(reply = '好的') {
  return {
    id: 'mock',
    created: 0,
    model: 'mock',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant' as const,
          content: JSON.stringify({ reply, card: null, read: { trait: 'reflecting', note: '测试' } }),
        },
        finish_reason: 'stop',
      },
    ],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('storyAgent edit context injection (U6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('injects edit context block into system prompt when annotations exist', async () => {
    mockGetRecentAnnotations.mockResolvedValueOnce([
      makeAnnotation(['删除了 2 张关于伤感的卡片'], ['倾向于克制的情感表达']),
    ]);
    mockInvokeLLM.mockResolvedValueOnce(makeAgentResponse());

    await replyFromStoryAgent({ message: '今天有点烦', projectId: 42 });

    const systemMessage = mockInvokeLLM.mock.calls[0][0].messages.find(
      (m) => m.role === 'system',
    );
    const systemContent = systemMessage?.content as string;
    expect(systemContent).toContain('用户编辑偏好');
    expect(systemContent).toContain('删除了 2 张关于伤感的卡片');
    expect(systemContent).toContain('倾向于克制的情感表达');
  });

  it('uses vanilla prompt (no edit block) when no annotations exist', async () => {
    mockGetRecentAnnotations.mockResolvedValueOnce([]);
    mockInvokeLLM.mockResolvedValueOnce(makeAgentResponse());

    await replyFromStoryAgent({ message: '今天有点烦', projectId: 42 });

    const systemMessage = mockInvokeLLM.mock.calls[0][0].messages.find(
      (m) => m.role === 'system',
    );
    const systemContent = systemMessage?.content as string;
    expect(systemContent).not.toContain('用户编辑偏好');
  });

  it('uses vanilla prompt when projectId is not provided', async () => {
    mockInvokeLLM.mockResolvedValueOnce(makeAgentResponse());

    await replyFromStoryAgent({ message: '今天有点烦' });

    expect(mockGetRecentAnnotations).not.toHaveBeenCalled();
    const systemMessage = mockInvokeLLM.mock.calls[0][0].messages.find(
      (m) => m.role === 'system',
    );
    expect((systemMessage?.content as string)).not.toContain('用户编辑偏好');
  });

  it('proceeds with vanilla prompt when annotation fetch throws', async () => {
    mockGetRecentAnnotations.mockRejectedValueOnce(new Error('DB error'));
    mockInvokeLLM.mockResolvedValueOnce(makeAgentResponse());

    const result = await replyFromStoryAgent({ message: '今天有点烦', projectId: 42 });

    // Agent still responds
    expect(result.reply).toBeDefined();
    const systemMessage = mockInvokeLLM.mock.calls[0][0].messages.find(
      (m) => m.role === 'system',
    );
    expect((systemMessage?.content as string)).not.toContain('用户编辑偏好');
  });

  it('aggregates facts and preferences from multiple annotations', async () => {
    mockGetRecentAnnotations.mockResolvedValueOnce([
      makeAnnotation(['删除了悲伤主题卡片'], ['偏好轻快基调']),
      makeAnnotation(['修改了对白使其简短'], ['偏好简洁对白']),
    ]);
    mockInvokeLLM.mockResolvedValueOnce(makeAgentResponse());

    await replyFromStoryAgent({ message: '继续', projectId: 42 });

    const systemContent = mockInvokeLLM.mock.calls[0][0].messages.find(
      (m) => m.role === 'system',
    )?.content as string;

    expect(systemContent).toContain('删除了悲伤主题卡片');
    expect(systemContent).toContain('修改了对白使其简短');
    expect(systemContent).toContain('偏好轻快基调');
    expect(systemContent).toContain('偏好简洁对白');
  });

  it('skips empty inferredPreferences from pending/fallback annotations', async () => {
    mockGetRecentAnnotations.mockResolvedValueOnce([
      makeAnnotation(['删除了 1 张卡片'], [], 'pending'), // fallback annotation, no prefs
    ]);
    mockInvokeLLM.mockResolvedValueOnce(makeAgentResponse());

    await replyFromStoryAgent({ message: '继续', projectId: 42 });

    const systemContent = mockInvokeLLM.mock.calls[0][0].messages.find(
      (m) => m.role === 'system',
    )?.content as string;

    // Has facts but no empty preference section
    expect(systemContent).toContain('删除了 1 张卡片');
    expect(systemContent).not.toContain('推断的创作偏好');
  });

  it('truncates edit context block when it exceeds token budget', async () => {
    const longFact = '这是一段很长的事实描述，'.repeat(200); // ~4000+ chars
    mockGetRecentAnnotations.mockResolvedValueOnce([
      makeAnnotation([longFact], ['某个偏好']),
    ]);
    mockInvokeLLM.mockResolvedValueOnce(makeAgentResponse());

    await replyFromStoryAgent({ message: '继续', projectId: 42 });

    const systemContent = mockInvokeLLM.mock.calls[0][0].messages.find(
      (m) => m.role === 'system',
    )?.content as string;

    // Block is present but capped
    expect(systemContent).toContain('用户编辑偏好');
    // Total system prompt should not be excessively long (edit block capped at ~4000 chars)
    const editBlockStart = systemContent.indexOf('=== 用户编辑偏好');
    const editBlockEnd = systemContent.indexOf('===', editBlockStart + 1);
    const blockLength = editBlockEnd - editBlockStart + 3;
    expect(blockLength).toBeLessThanOrEqual(4200); // budget + closing ===
  });

  it('passes projectId to getRecentAnnotations', async () => {
    mockGetRecentAnnotations.mockResolvedValueOnce([]);
    mockInvokeLLM.mockResolvedValueOnce(makeAgentResponse());

    await replyFromStoryAgent({ message: '继续', projectId: 99 });

    expect(mockGetRecentAnnotations).toHaveBeenCalledWith(99, 5);
  });

  it('includes transparency instruction in edit context block', async () => {
    mockGetRecentAnnotations.mockResolvedValueOnce([
      makeAnnotation(['修改了卡片'], ['偏好轻快']),
    ]);
    mockInvokeLLM.mockResolvedValueOnce(makeAgentResponse());

    await replyFromStoryAgent({ message: '继续', projectId: 42 });

    const systemContent = mockInvokeLLM.mock.calls[0][0].messages.find(
      (m) => m.role === 'system',
    )?.content as string;

    expect(systemContent).toContain('可以偶尔自然地提及');
  });
});

// ─── U8: Error handling — fallback context format ────────────────────────────

describe('storyAgent fallback context injection (U8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses fallback header when all annotations are pending (circuit breaker tripped)', async () => {
    mockGetRecentAnnotations.mockResolvedValueOnce([
      makeAnnotation(['删除了 2 张卡片'], [], 'pending'),
      makeAnnotation(['修改了剧本场景 3 的对话'], [], 'pending'),
    ]);
    mockInvokeLLM.mockResolvedValueOnce(makeAgentResponse());

    await replyFromStoryAgent({ message: '继续', projectId: 42 });

    const systemContent = mockInvokeLLM.mock.calls[0][0].messages.find(
      (m) => m.role === 'system',
    )?.content as string;

    expect(systemContent).toContain('用户最近的编辑');
    expect(systemContent).not.toContain('用户编辑偏好');
    expect(systemContent).toContain('删除了 2 张卡片');
    expect(systemContent).toContain('修改了剧本场景 3 的对话');
  });

  it('uses full header when active annotations are present, even mixed with pending', async () => {
    mockGetRecentAnnotations.mockResolvedValueOnce([
      makeAnnotation(['删除了 1 张卡片'], ['偏好克制风格'], 'active'),
      makeAnnotation(['修改了对白'], [], 'pending'),
    ]);
    mockInvokeLLM.mockResolvedValueOnce(makeAgentResponse());

    await replyFromStoryAgent({ message: '继续', projectId: 42 });

    const systemContent = mockInvokeLLM.mock.calls[0][0].messages.find(
      (m) => m.role === 'system',
    )?.content as string;

    expect(systemContent).toContain('用户编辑偏好（基于本项目历史）');
    expect(systemContent).not.toContain('用户最近的编辑');
    // Facts from both active and pending annotations
    expect(systemContent).toContain('删除了 1 张卡片');
    expect(systemContent).toContain('修改了对白');
    // Preferences only from active
    expect(systemContent).toContain('偏好克制风格');
  });

  it('omits preference section entirely in fallback format', async () => {
    mockGetRecentAnnotations.mockResolvedValueOnce([
      makeAnnotation(['删除了卡片'], [], 'pending'),
    ]);
    mockInvokeLLM.mockResolvedValueOnce(makeAgentResponse());

    await replyFromStoryAgent({ message: '继续', projectId: 42 });

    const systemContent = mockInvokeLLM.mock.calls[0][0].messages.find(
      (m) => m.role === 'system',
    )?.content as string;

    expect(systemContent).not.toContain('推断的创作偏好');
    expect(systemContent).not.toContain('可以偶尔自然地提及');
  });

  it('includes facts from pending annotations in full-format block', async () => {
    mockGetRecentAnnotations.mockResolvedValueOnce([
      makeAnnotation(['新增了 3 张卡片'], ['偏好自然基调'], 'active'),
      makeAnnotation(['删除了 1 张镜头'], [], 'pending'), // fallback fact still useful
    ]);
    mockInvokeLLM.mockResolvedValueOnce(makeAgentResponse());

    await replyFromStoryAgent({ message: '继续', projectId: 42 });

    const systemContent = mockInvokeLLM.mock.calls[0][0].messages.find(
      (m) => m.role === 'system',
    )?.content as string;

    expect(systemContent).toContain('新增了 3 张卡片');
    expect(systemContent).toContain('删除了 1 张镜头');
    expect(systemContent).toContain('偏好自然基调');
  });

  it('logs fallback rate when injecting context', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGetRecentAnnotations.mockResolvedValueOnce([
      makeAnnotation(['删除了卡片'], [], 'pending'),
      makeAnnotation(['修改了镜头'], [], 'pending'),
    ]);
    mockInvokeLLM.mockResolvedValueOnce(makeAgentResponse());

    await replyFromStoryAgent({ message: '继续', projectId: 42 });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[editContext] Injecting: 0 active, 2 fallback annotations'),
    );

    consoleSpy.mockRestore();
  });

  it('agent generation proceeds even when all annotations are fallback', async () => {
    mockGetRecentAnnotations.mockResolvedValueOnce([
      makeAnnotation(['删除了 5 张卡片'], [], 'pending'),
    ]);
    mockInvokeLLM.mockResolvedValueOnce(makeAgentResponse('继续聊'));

    const result = await replyFromStoryAgent({ message: '继续', projectId: 42 });

    expect(result.reply).toBe('继续聊');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// U1：声音地基契约 —— 把小酌从「情绪取样器」改为「激发倾诉的陪伴者」
//
// 这些是结构化的「提示词契约」测试：mock 掉 LLM，捕获送进去的 system prompt，
// 断言取样器/身体审问/负面偏置/贴标确认这些禁语已经消失，陪伴者立场与如实镜像
// 硬约束已经写入。行为层面的验收（照见是否到位、线头是否真实）由人工实测 rubric
// 覆盖，不在此处。覆盖需求 R1/R2/R3，对应 AE8/AE6。
// ─────────────────────────────────────────────────────────────────────────────
describe('storyAgent 声音地基契约 (U1：取样器 → 陪伴者)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 跑一轮对话（默认不带 projectId → 不注入编辑上下文），返回 system prompt 文本。
  // 可通过 overrides 调出条件分支（existingCardCount 触发叙事弧线、similarCards 触发相似记忆块）。
  async function getSystemPrompt(
    overrides: Partial<Parameters<typeof replyFromStoryAgent>[0]> = {},
  ): Promise<string> {
    mockInvokeLLM.mockResolvedValueOnce(makeAgentResponse());
    await replyFromStoryAgent({ message: '今天下午晒了会儿太阳，挺舒服的', ...overrides });
    return mockInvokeLLM.mock.calls[0][0].messages.find((m) => m.role === 'system')
      ?.content as string;
  }

  it('清除取样器语言：不再出现「采样情绪 / 情绪样本卡」式措辞 (R1)', async () => {
    const prompt = await getSystemPrompt();
    expect(prompt).not.toContain('采样情绪');
    expect(prompt).not.toContain('情绪样本卡');
  });

  it('立住陪伴者立场与「如实镜像」硬约束 (R1, R3, AE8/AE6)', async () => {
    const prompt = await getSystemPrompt();
    expect(prompt).toContain('陪一个人把心里的感觉说出来');
    expect(prompt).toContain('如实镜像');
    // R3 的核心：开心就接住开心，不为戏剧性翻负
    expect(prompt).toContain('他讲开心，接住的就是开心');
  });

  it('清除贴标确认 tic：不再强制 reply 问「我先把它记成 X」 (R2)', async () => {
    const prompt = await getSystemPrompt();
    // 旧指令：「reply 里必须自然地问一句『我先把它记成 X，你觉得准吗？』」
    expect(prompt).not.toContain('必须自然地问一句');
    // 改为显式禁止贴标确认
    expect(prompt).toContain('不贴标确认');
  });

  it('清除身体审问：不再问身体部位 / 松紧 (R2, AE8)', async () => {
    // 身体审问散落在主信念、numb 应对、叙事弧线里；用带卡片的分支一并覆盖
    const prompt = await getSystemPrompt({ existingCardCount: 5 });
    expect(prompt).not.toContain('身体哪个部位');
    expect(prompt).not.toContain('身体是松的还是紧的');
    expect(prompt).not.toContain('身体感受切入');
  });

  it('保留少问多接 / 留白的追问纪律 (R1)', async () => {
    const prompt = await getSystemPrompt();
    expect(prompt).toContain('少问，多接');
    expect(prompt).toContain('给留白');
  });

  it('叙事弧线（≥4 卡）不再翻负、不再问反方向 (R2, R3)', async () => {
    // existingCardCount >= 4 才会进入「叙事弧线 · 现在用得上了」分支
    const prompt = await getSystemPrompt({ existingCardCount: 5 });
    expect(prompt).not.toContain('问一个反方向的问题');
    // 改为如实跟随：平就让它平，不翻负面反面
    expect(prompt).toContain('不要去翻出一个负面的反面来');
  });

  it('相似记忆块不再用「反方向更容易长出剧情起伏」式偏置 (R2)', async () => {
    // similarCards 非空才会注入 formatSimilarMemoryCards 块
    const prompt = await getSystemPrompt({
      similarCards: [{ content: '上次也提到过一个类似的下午' }],
    });
    expect(prompt).not.toContain('更容易长出剧情起伏');
    expect(prompt).not.toContain('优先问这个差异');
    // 改为顺着对方此刻真实的情绪接话
    expect(prompt).toContain('顺着对方此刻真实的情绪接话');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// U1：asEmotionOptions —— 去掉方向性硬编码默认词（决策 D6）
// 情绪选项必须来自模型，方向跟着用户此刻真实的情绪；不再把一组固定词顶在最前。
// ─────────────────────────────────────────────────────────────────────────────
describe('asEmotionOptions 去方向性默认词 (U1, D6)', () => {
  it('原样返回模型给的候选（去重、最多 7 个）', () => {
    expect(asEmotionOptions(['松弛', '满足'])).toEqual(['松弛', '满足']);
    expect(asEmotionOptions(['松弛', '松弛', '满足'])).toEqual(['松弛', '满足']);
  });

  it('不再注入 ["感动","好奇","清醒","释然","松弛"] 这组方向性默认词', () => {
    // 旧实现会把这组词顶在最前，导致模型即便返回正向词，前几个仍是固定词
    const result = asEmotionOptions(['开心']);
    expect(result).toEqual(['开心']);
    expect(result).not.toContain('感动');
    expect(result).not.toContain('清醒');
  });

  it('空输入 / 非数组返回空数组，而不是注入默认方向', () => {
    expect(asEmotionOptions([])).toEqual([]);
    expect(asEmotionOptions(undefined)).toEqual([]);
    expect(asEmotionOptions(null)).toEqual([]);
    expect(asEmotionOptions('感动')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// U2：照见真实的好 + 不灌鸡汤硬护栏（R7-R9）
// 在地基之上，小酌不只「接住」还会「照见」——温柔指认用户讲述里真有的好并归还给他；
// 同时一条与「不翻负」对称的硬护栏，禁止鸡汤、强行升华、替用户拔高、无中生有。
// 这里只做结构化契约（指令是否在 prompt 里）；行为实测（AE4/AE5/AE6）移交 U5 rubric。
// ─────────────────────────────────────────────────────────────────────────────
describe('storyAgent 照见与不灌鸡汤护栏 (U2：R7-R9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 照见块是无条件注入的（不在 existingCardCount / similarCards 分支后），vanilla 即可断言。
  async function getSystemPrompt(): Promise<string> {
    mockInvokeLLM.mockResolvedValueOnce(makeAgentResponse());
    await replyFromStoryAgent({ message: '今天帮邻居把走丢的猫找回来了，挺开心' });
    return mockInvokeLLM.mock.calls[0][0].messages.find((m) => m.role === 'system')
      ?.content as string;
  }

  it('注入「照见真实的好」指令：指认 + 归还，且归还给用户自己 (R7, R8)', async () => {
    const prompt = await getSystemPrompt();
    expect(prompt).toContain('照见');
    expect(prompt).toContain('指认');
    expect(prompt).toContain('归还');
    // 归还的落点是「属于他自己」，不是小酌站在高处给的评价
    expect(prompt).toContain('属于你自己');
  });

  it('照见 ≠ 恭维 / 打分 / 评价：明确与鼓掌词区分 (R8)', async () => {
    const prompt = await getSystemPrompt();
    expect(prompt).toContain('不是恭维');
    expect(prompt).toContain('不是打分');
    // 沿用语气锚点「这个很小，但很像你」，从细节里渗出而非颁奖
    expect(prompt).toContain('这个很小，但很像你');
  });

  it('注入「不灌鸡汤」对称硬护栏：正向失真与负面偏置同罪 (R9)', async () => {
    const prompt = await getSystemPrompt();
    expect(prompt).toContain('正向失真和负面偏置同罪');
    expect(prompt).toContain('不灌鸡汤');
    expect(prompt).toContain('不强行升华');
    expect(prompt).toContain('不替用户拔高');
  });

  it('设「宁可不照见」兜底：拿不准时默认沉默，不硬安一个升华 (R9)', async () => {
    const prompt = await getSystemPrompt();
    expect(prompt).toContain('宁可不照见');
    // 只照见真有的好；没有就不照见
    expect(prompt).toContain('只照见');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 照见分层 · 独有的强项高阶档（R7 扩展）
// 在「照见真实的好」之上分两层：品格随时可镜（默认）；独有的强项门槛更高，
// 只在「够料 + 自我呈现场景」两个条件都满足时才点，且镜的是「事实的组合」而非形容词。
// 与不灌鸡汤护栏同源，且对这一层更紧（硬安一个强项 = 替用户造人设）。
// 这里只做结构化契约；行为实测移交人工 rubric。
// ─────────────────────────────────────────────────────────────────────────────
describe('storyAgent 照见分层 · 独有的强项高阶档 (R7 扩展)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getSystemPrompt(): Promise<string> {
    mockInvokeLLM.mockResolvedValueOnce(makeAgentResponse());
    await replyFromStoryAgent({ message: '今天帮邻居把走丢的猫找回来了，挺开心' });
    return mockInvokeLLM.mock.calls[0][0].messages.find((m) => m.role === 'system')
      ?.content as string;
  }

  it('注入照见的两层：品格默认 + 独有的强项高阶档', async () => {
    const prompt = await getSystemPrompt();
    expect(prompt).toContain('照见分两层');
    expect(prompt).toContain('独有的强项');
  });

  it('独有的强项有双门槛：够料 + 自我呈现场景', async () => {
    const prompt = await getSystemPrompt();
    expect(prompt).toContain('够料');
    expect(prompt).toContain('想看清「我是谁」');
  });

  it('照见独有的强项镜「事实的组合」而非形容词式评价', async () => {
    const prompt = await getSystemPrompt();
    expect(prompt).toContain('事实的组合');
    expect(prompt).toContain('不是形容词');
  });

  it('对这一层的护栏更紧：硬安强项 = 替用户造人设，拿不准退回第一层', async () => {
    const prompt = await getSystemPrompt();
    expect(prompt).toContain('人设');
    expect(prompt).toContain('退回第一层');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// U3：收尾留真实线头（R10-R11）
// 让一段对话的收尾温暖地留一个「基于这次真实聊到内容」的开放、可不接的邀请，
// 使人「聊完还想再来」；杜绝人造悬念 / 套路化钩子。收尾口径与 R6/R13 协同：
// 不承诺永久记忆，也不否认将来会有（为第二步 DATABASE_URL 记忆留接口）。
// 这里只做结构化契约；行为实测（AE7）移交 U5 rubric。
// ─────────────────────────────────────────────────────────────────────────────
describe('storyAgent 收尾留线头 (U3：R10-R11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getSystemPrompt(): Promise<string> {
    mockInvokeLLM.mockResolvedValueOnce(makeAgentResponse());
    await replyFromStoryAgent({ message: '聊得差不多了，我得去做饭了' });
    return mockInvokeLLM.mock.calls[0][0].messages.find((m) => m.role === 'system')
      ?.content as string;
  }

  it('注入「收尾留真实线头」指令：取材本次、开放可不接 (R10, R11)', async () => {
    const prompt = await getSystemPrompt();
    expect(prompt).toContain('线头');
    // 线头必须从这次真实聊到的内容里伸出来，不是凭空抛
    expect(prompt).toContain('这次真实聊到的内容');
    // 是可接可不接的邀请，不是作业
    expect(prompt).toContain('可不接');
  });

  it('禁止人造悬念 / 套路化钩子 (R11)', async () => {
    const prompt = await getSystemPrompt();
    expect(prompt).toContain('假钩子');
    expect(prompt).toContain('人造悬念');
    expect(prompt).toContain('套路化');
  });

  it('记忆口径：收尾不植入「永久记得 / 永远记住」式承诺，但保留不夸口护栏 (R6/R13, AE3)', async () => {
    const prompt = await getSystemPrompt();
    // 提示词本身不得埋下永久记忆的承诺措辞（回归守卫：防止以后有人加回「我会永久记得你」）
    expect(prompt).not.toContain('永久记得');
    expect(prompt).not.toContain('永远记住');
    expect(prompt).not.toContain('永远记得');
    expect(prompt).not.toContain('永久保存');
    // 但护栏要在场：明确指示别把它说成永久的承诺
    expect(prompt).toContain('永久的承诺');
  });
});
