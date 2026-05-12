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
import { replyFromStoryAgent } from './storyAgent';
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
