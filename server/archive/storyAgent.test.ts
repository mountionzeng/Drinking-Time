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
import { replyFromStoryAgent, asEmotionOptions, synthesizeShotList } from './storyAgent';
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

beforeEach(() => {
  mockGetRecentAnnotations.mockReset();
  mockInvokeLLM.mockReset();
  mockInvokeLLM.mockResolvedValue(makeAgentResponse());
});

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

  it('injects Story Cards as job-search gap context for the chat agent', async () => {
    mockGetRecentAnnotations.mockResolvedValueOnce([]);
    mockInvokeLLM.mockResolvedValueOnce(makeAgentResponse());

    await replyFromStoryAgent({
      message: '下一步该问什么？',
      projectId: 42,
      existingCardCount: 3,
      confirmedIntent: {
        purpose: 'linkedin_job_search',
        audience: 'recruiters',
        targetRole: '创业公司合伙人',
      },
      storyCards: [
        {
          title: '我知道流程怎么运作',
          content: '用户说自己能把抽象需求变成画面，让观众理解共通情感。',
          emotion: '清醒',
          themeHints: ['能力主张', '视觉表达'],
        },
        {
          title: '缺少外部价值',
          content: '目前还没有说明这种能力对团队、公司或产品有什么具体价值。',
          emotion: '待补',
          themeHints: ['外部价值', '证据缺口'],
        },
      ],
    });

    const systemMessage = mockInvokeLLM.mock.calls[0][0].messages.find(
      (m) => m.role === 'system',
    );
    const systemContent = systemMessage?.content as string;
    expect(systemContent).toContain('当前 Story Cards 全局上下文');
    expect(systemContent).toContain('我知道流程怎么运作');
    expect(systemContent).toContain('缺少外部价值');
    expect(systemContent).toContain('求职故事缺口诊断');
    expect(systemContent).toContain('不要等用户问');
    expect(systemContent).toContain('为什么有这个能力');
    expect(systemContent).toContain('带来什么外部价值');
    expect(systemContent).toContain('先给出你的推断，再请用户确认或修正');
    expect(systemContent).toContain('这个说法接近吗');
    expect(systemContent).toContain('一次只点一个最关键缺口');
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

// ─────────────────────────────────────────────────────────────────────────────
// 网关抖动韧性 · 临时失败自动重试 + 优雅兜底
// 真实环境里 302 网关偶发 5xx/超时。旧实现把任何失败都抛成前端一句吞掉真实原因的
// 「Agent 暂时没接上，再试一次？」并断掉对话。现在：通道层对临时错误自动重试一次；
// 仍失败则 replyFromStoryAgent 优雅兜底（configured:true + 一句小酌口吻的「没接住」回复，
// 不抛错、不断对话）。确定性错误（鉴权 401 等）不重试，免得白白拖慢真实报错。
// ─────────────────────────────────────────────────────────────────────────────
describe('storyAgent 网关抖动韧性 (临时失败重试 + 优雅兜底)', () => {
  function isExtractionRequest(input: Parameters<typeof invokeLLM>[0]): boolean {
    const systemContent = input.messages.find((m) => m.role === 'system')?.content;
    return typeof systemContent === 'string' && systemContent.includes('后台分析器');
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // 本块用到持久 mockRejectedValue，clearAllMocks 不会重置实现，显式重置避免泄漏到后续用例
    mockInvokeLLM.mockReset();
  });

  it('临时失败（502）自动重试一次后成功，返回真实回复', async () => {
    let replyAttempts = 0;
    mockInvokeLLM.mockImplementation(async (input) => {
      if (isExtractionRequest(input)) return makeAgentResponse();
      replyAttempts += 1;
      if (replyAttempts === 1) {
        throw new Error('LLM invoke failed: 502 Bad Gateway – upstream');
      }
      return makeAgentResponse('我在，你接着说');
    });

    const result = await replyFromStoryAgent({ message: '今天有点累' });

    // B 改造后一轮正常 = 两次调用；这里回话先 502 重试一次才成功，故共 3 次
    expect(mockInvokeLLM).toHaveBeenCalledTimes(3); // 回话(1 失败 + 1 重试) + 抽取(1)
    expect(replyAttempts).toBe(2);
    expect(result.configured).toBe(true);
    expect(result.reply).toBe('我在，你接着说');
  });

  it('重试后仍失败 → 优雅兜底，不抛错、不断对话', async () => {
    let replyAttempts = 0;
    mockInvokeLLM.mockImplementation(async (input) => {
      if (isExtractionRequest(input)) return makeAgentResponse();
      replyAttempts += 1;
      throw new Error('LLM invoke failed: 503 Service Unavailable');
    });

    const result = await replyFromStoryAgent({ message: '今天有点累' });

    expect(replyAttempts).toBe(2); // 1 次 + 1 次重试
    expect(mockInvokeLLM).toHaveBeenCalledTimes(3); // 回话(2) + 并行抽取(1)
    // configured 必须是 true：若返回 false 前端会误弹「接口还没配置模型 API」
    expect(result.configured).toBe(true);
    expect(result.modelLabel).toBe('请求失败');
    expect(result.reply).toContain('没接住'); // 小酌口吻的兜底回复
    expect(result.card).toBeNull();
  });

  it('确定性错误（鉴权 401）不重试，直接优雅兜底', async () => {
    let replyAttempts = 0;
    mockInvokeLLM.mockImplementation(async (input) => {
      if (isExtractionRequest(input)) return makeAgentResponse();
      replyAttempts += 1;
      throw new Error('LLM invoke failed: 401 Unauthorized – bad key');
    });

    const result = await replyFromStoryAgent({ message: '今天有点累' });

    expect(replyAttempts).toBe(1); // 401 不重试
    expect(mockInvokeLLM).toHaveBeenCalledTimes(2); // 回话(1) + 并行抽取(1)
    expect(result.configured).toBe(true);
    expect(result.reply).toContain('没接住');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B 改造 · 「回话」与「出卡」彻底解耦（两次调用）
// 根因：旧实现要模型一边演小酌、一边在同一次调用里憋出 16 字段严格 JSON；尤其一喂图就破功，
// 模型直接说人话、丢掉 JSON 外壳 → card 永远为 null（用户反复踩的「能聊天但一直不出卡」）。
// B 把一轮拆成两次：第一次只「自然回话」（纯文本，robust）；第二次交给无人设的「后台分析器」
// 单独吐严格 JSON（read / card / 可选 toolCalls）。第二次怎么崩都不致命，绝不回头影响 reply。
// 这些用例锁住这层解耦契约：两次调用各司其职 + 抽取怎么崩都不伤 reply。
// 注意：测试态 ENV 没有 llmSupportsResponseFormat，两次调用都不带 json_object，纯验证解耦逻辑。
// ─────────────────────────────────────────────────────────────────────────────
describe('storyAgent B 改造 · 回话/出卡解耦 (两次调用)', () => {
  // 回话响应：content 是纯人话（生产里第一步模型直接吐文本，用户直接看到）
  function makeRawResponse(rawContent: string) {
    return {
      id: 'mock',
      created: 0,
      model: 'mock',
      choices: [
        {
          index: 0,
          message: { role: 'assistant' as const, content: rawContent },
          finish_reason: 'stop',
        },
      ],
    };
  }

  // 抽取响应：content 是严格 JSON（read / card），由无人设后台分析器返回
  function makeExtractionResponse(payload: { card?: unknown; read?: unknown } = {}) {
    const body = { card: payload.card ?? null, read: payload.read ?? null };
    return makeRawResponse(JSON.stringify(body));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvokeLLM.mockReset(); // 本块用持久 mock，显式重置避免泄漏
  });

  it('正常一轮 = 两次调用：回话纯文本 + 后台抽取出卡', async () => {
    mockInvokeLLM
      .mockResolvedValueOnce(makeRawResponse('这张照片好治愈啊，是在海边吗'))                                  // 回话：纯人话
      .mockResolvedValueOnce(makeExtractionResponse({ card: { content: '海边的傍晚', rawText: '在海边松了口气' } })); // 抽取：出卡

    const result = await replyFromStoryAgent({ message: '你看这张', photoUrl: 'https://x/p.jpg' });

    expect(mockInvokeLLM).toHaveBeenCalledTimes(2);             // 回话 1 + 抽取 1
    expect(result.reply).toBe('这张照片好治愈啊，是在海边吗'); // 回复来自第一步纯文本
    expect(result.card).not.toBeNull();
    expect(result.card?.content).toBe('海边的傍晚');           // 卡片来自第二步抽取
  });

  it('抽取破功（吐人话 / 非 JSON）→ 非致命：card=null 但 reply 完好', async () => {
    mockInvokeLLM
      .mockResolvedValueOnce(makeRawResponse('我懂那种感觉。'))                       // 回话正常
      .mockResolvedValueOnce(makeRawResponse('这是一段普通的人话，完全没有大括号。')); // 抽取破功

    const result = await replyFromStoryAgent({ message: '今天有点累' });

    expect(mockInvokeLLM).toHaveBeenCalledTimes(2);
    expect(result.configured).toBe(true);
    expect(result.reply).toBe('我懂那种感觉。'); // reply 不受抽取破功影响
    expect(result.card).toBeNull();
  });

  it('回话被模型包进 ```json 代码块 → extractReplyText 解包成干净一段话', async () => {
    mockInvokeLLM
      .mockResolvedValueOnce(makeRawResponse('```json{"reply":"我在，你慢慢说"}```')) // 回话被包进代码块 + JSON 外壳
      .mockResolvedValueOnce(makeExtractionResponse());

    const result = await replyFromStoryAgent({ message: '我想说点事' });

    expect(result.reply).toBe('我在，你慢慢说'); // 围栏 + JSON 外壳都被剥掉，只留干净一段话
    expect(result.card).toBeNull();
  });

  it('两次调用各用对的系统提示：回话带人设 / 抽取无人设', async () => {
    mockInvokeLLM
      .mockResolvedValueOnce(makeRawResponse('我在听'))
      .mockResolvedValueOnce(makeExtractionResponse());

    await replyFromStoryAgent({ message: '今天有点开心' });

    const replySystem = mockInvokeLLM.mock.calls[0][0].messages.find((m) => m.role === 'system')?.content as string;
    const extractionSystem = mockInvokeLLM.mock.calls[1][0].messages.find((m) => m.role === 'system')?.content as string;
    // 回话那步是「小酌」人设、只输出一段话
    expect(replySystem).toContain('小酌');
    expect(replySystem).toContain('这一轮只输出一段话');
    // 抽取那步是无人设后台分析器
    expect(extractionSystem).toContain('后台分析器');
    expect(extractionSystem).toContain('不扮演任何人设');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 求职意图进入聊天链路：用户确认「求职」后，storyAgent.chat 必须换成求职专家任务，
// 并把 JD / 简历 / 项目证据作为可持续出卡的素材，而不是继续按普通情绪小事陪聊。
// 这组回归测试覆盖测试 #21 暴露的问题：小酌不接简历、聊很久仍没推进求职任务、
// 5 张卡后求职信息不再沉淀。
// ─────────────────────────────────────────────────────────────────────────────
describe('storyAgent 求职意图聊天触发', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvokeLLM.mockReset();
  });

  it('把 confirmed job intent 注入回话 prompt，并优先接住目标岗位/JD/简历', async () => {
    mockInvokeLLM
      .mockResolvedValueOnce(makeAgentResponse('可以，把简历贴给我看看。'))
      .mockResolvedValueOnce(makeAgentResponse());

    await replyFromStoryAgent({
      message: '或许我可以把我的简历给你看看',
      existingCardCount: 5,
      confirmedIntent: {
        purpose: 'linkedin_job_search',
        audience: 'recruiters',
        platform: 'linkedin',
        targetRole: '产品经理',
        channel: 'linkedin',
      },
    });

    const replySystem = mockInvokeLLM.mock.calls[0][0].messages.find(
      (m) => m.role === 'system',
    )?.content as string;

    expect(replySystem).toContain('求职影片顾问');
    expect(replySystem).toContain('目标职位或目标方向');
    expect(replySystem).toContain('如果有 JD，建议他贴出来');
    expect(replySystem).toContain('必须接住并请他贴简历');
    expect(replySystem).toContain('招聘者为什么相信你');
    expect(replySystem).toContain('已知目标岗位/方向：产品经理');
    expect(replySystem).toContain('不要把 4-5 张卡当成上限');
  });

  it('求职模式的后台抽取把简历/JD/项目证据当作 card 素材', async () => {
    mockInvokeLLM
      .mockResolvedValueOnce(makeAgentResponse('可以，把简历贴给我看看。'))
      .mockResolvedValueOnce(makeAgentResponse());

    await replyFromStoryAgent({
      message: '或许我可以把我的简历给你看看',
      confirmedIntent: {
        purpose: 'linkedin_job_search',
        audience: 'recruiters',
        platform: 'linkedin',
      },
    });

    const extractionSystem = mockInvokeLLM.mock.calls[1][0].messages.find(
      (m) => m.role === 'system',
    )?.content as string;
    const extractionPayload = JSON.stringify(mockInvokeLLM.mock.calls[1][0].messages);

    expect(extractionSystem).toContain('当前是求职片模式');
    expect(extractionSystem).toContain('职位描述、JD 要求、简历内容');
    expect(extractionSystem).toContain('项目事实、量化成果');
    expect(extractionSystem).toContain('card 就不要为 null');
    expect(extractionSystem).toContain('招聘者视角');
    expect(extractionPayload).not.toContain('可以，把简历贴给我看看。');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// synthesizeShotList 兜底韧性 · shots 缺失 / 坏 JSON 时降级出兜底分镜，绝不弹「整理失败」
// 文件里早有完整的 buildFallbackShotList，但旧实现只在 parse 抛错的 catch 里用了它；
// 当模型「返回了合法 JSON、但 shots 为空 / 所有镜头都缺 action」时，旧实现直接 return error，
// 前端就弹「整理失败：模型没有返回有效的 shots 列表」——这正是用户踩到的 live bug。
// 本块把这条降级链钉死：四种输入都不许返回 error，都要拿到能用的 shots。
// ─────────────────────────────────────────────────────────────────────────────
describe('synthesizeShotList 兜底韧性 (shots 缺失/坏 JSON → 兜底分镜)', () => {
  function makeShotResponse(payload: unknown) {
    return {
      id: 'mock', created: 0, model: 'mock',
      choices: [
        { index: 0, message: { role: 'assistant' as const, content: JSON.stringify(payload) }, finish_reason: 'stop' },
      ],
    };
  }
  function makeRawResponse(rawContent: string) {
    return {
      id: 'mock', created: 0, model: 'mock',
      choices: [
        { index: 0, message: { role: 'assistant' as const, content: rawContent }, finish_reason: 'stop' },
      ],
    };
  }
  const cards = [
    { content: '加班到很晚回家，路过便利店亮着的灯' },
    { content: '站在灯光下，鼻子有点发酸' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvokeLLM.mockReset();
  });

  it('合法 JSON 但 shots 为空 → 降级出兜底分镜，绝不返回 error', async () => {
    mockInvokeLLM.mockResolvedValue(
      makeShotResponse({ characters: [], shots: [], arc: '', logline: '', theme: '', variants: [] }),
    );

    const result = await synthesizeShotList({ cards });

    expect('error' in result).toBe(false); // 不再弹「整理失败」
    const shots = (result as { shots: Array<{ note: string }> }).shots;
    expect(Array.isArray(shots)).toBe(true);
    expect(shots.length).toBeGreaterThan(0); // 按卡片兜出镜头
    expect(shots[0].note).toContain('兜底'); // 确实是 buildFallbackShotList 兜出来的
  });

  it('合法 JSON 但所有镜头都缺 action → 同样降级兜底', async () => {
    mockInvokeLLM.mockResolvedValue(
      makeShotResponse({ shots: [{ shotNo: 1, subject: '人', action: '' }, { shotNo: 2, subject: '灯', action: '   ' }] }),
    );

    const result = await synthesizeShotList({ cards });

    expect('error' in result).toBe(false);
    expect((result as { shots: unknown[] }).shots.length).toBeGreaterThan(0);
  });

  it('模型直接说人话（坏 JSON）→ 走 catch 兜底，不抛错', async () => {
    mockInvokeLLM.mockResolvedValue(makeRawResponse('这些素材我先帮你想想哈'));

    const result = await synthesizeShotList({ cards });

    expect('error' in result).toBe(false);
    expect((result as { shots: unknown[] }).shots.length).toBeGreaterThan(0);
  });

  it('合法 JSON 且 shots 正常 → 原样返回模型镜头（正常路径回归守卫）', async () => {
    mockInvokeLLM.mockResolvedValue(
      makeShotResponse({
        characters: [{ name: '我', role: '主视点', oneLiner: '深夜归人' }],
        arc: '疲惫 → 被接住',
        logline: '一个人深夜被便利店的灯接住',
        theme: '微小的慰藉',
        variants: [],
        shots: [
          {
            shotNo: 1,
            subject: '便利店',
            action: '远远看见亮着的灯',
            beat: '开场',
            shotType: '远',
            intent: '证明用户能发现微小价值',
            rationale: '这不是情绪海报，而是在展示他对环境信号的捕捉。',
          },
          { shotNo: 2, subject: '我', action: '站在灯下鼻子发酸', beat: '收束', shotType: '近' },
        ],
      }),
    );

    const result = await synthesizeShotList({
      cards,
      resonanceContext: '【用户已确认意图】用途=linkedin_job_search；给谁看=recruiters',
    });

    expect('error' in result).toBe(false);
    const r = result as {
      shots: Array<{ note: string; intent?: string | null; rationale?: string | null }>;
      logline: string;
    };
    expect(r.shots.length).toBeGreaterThan(0);
    expect(r.logline).toBe('一个人深夜被便利店的灯接住'); // 用模型的 logline，证明走的是正常路径
    expect(r.shots[0].note).not.toContain('兜底'); // 不是兜底镜头
    expect(r.shots[0].intent).toBe('证明用户能发现微小价值');
    expect(r.shots[0].rationale).toBe('这不是情绪海报，而是在展示他对环境信号的捕捉。');
  });

  it('求职意图下模型漏填 dialogue → 服务端补成招聘者能读懂的优势字幕', async () => {
    mockInvokeLLM.mockResolvedValue(
      makeShotResponse({
        characters: [{ name: '候选人', role: '求职短片主视点', oneLiner: '系统化产品人' }],
        arc: '岗位关切 → 能力证据',
        logline: '把系统化理解变成岗位竞争力',
        theme: '能力需要被验证',
        variants: [],
        shots: [
          {
            shotNo: 1,
            subject: '系统流程图',
            action: '把复杂流程拆成可验证步骤',
            dialogue: '',
            beat: '开场',
            shotType: '中',
            intent: '证明候选人能拆解复杂问题',
            rationale: '招聘者需要看到具体判断方式。',
            sourceCardContent: '我知道整个流程是怎么运作的，能把抽象需求拆成流程和验证动作。',
          },
        ],
      }),
    );

    const result = await synthesizeShotList({
      cards: [
        {
          title: '系统化理解',
          content: '我知道整个流程是怎么运作的，能把抽象需求拆成流程和验证动作。',
        },
      ],
      confirmedIntent: {
        purpose: 'linkedin_job_search',
        audience: 'recruiters',
        platform: 'linkedin',
        targetRole: 'AIGC PM',
      },
    });

    expect('error' in result).toBe(false);
    const shot = (result as { shots: Array<{ dialogue: string }> }).shots[0];
    expect(shot.dialogue).toContain('系统化理解');
    expect(shot.dialogue).toContain('AIGC PM');
  });

  it('求职意图下模型坏 JSON → 兜底分镜仍按优势证据链生成', async () => {
    mockInvokeLLM.mockResolvedValue(makeRawResponse('先想想怎么拍'));

    const result = await synthesizeShotList({
      cards: [
        {
          title: '系统化理解',
          content: '我知道整个流程是怎么运作的，能把抽象需求拆成流程和验证动作。',
          sourceQuote: '我知道整个流程是怎么运作的',
        },
      ],
      confirmedIntent: {
        purpose: 'linkedin_job_search',
        audience: 'recruiters',
        platform: 'linkedin',
        targetRole: 'AIGC PM',
      },
    });

    expect('error' in result).toBe(false);
    const shot = (result as { logline: string; shots: Array<{ dialogue: string; intent?: string | null; rationale?: string | null; note: string }> }).shots[0];
    expect((result as { logline: string }).logline).toContain('AIGC PM');
    expect(shot.note).toContain('求职卡片');
    expect(shot.dialogue).toContain('我知道整个流程是怎么运作的');
    expect(shot.intent).toContain('招聘者');
    expect(shot.rationale).toContain('岗位关切');
  });
});
