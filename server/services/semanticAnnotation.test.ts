import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateAnnotation, isCircuitOpen, resetCircuitBreaker } from './semanticAnnotation';
import type { EditDiff } from '../_core/editDiff';
import type { SemanticAnnotation } from '../db';
import { ENV } from '../_core/env';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../db', () => ({
  createSemanticAnnotation: vi.fn(),
}));

import { createSemanticAnnotation } from '../db';

const mockCreateAnnotation = vi.mocked(createSemanticAnnotation);
const originalOpenAINext = {
  apiKey: ENV.openaiNextApiKey,
  baseUrl: ENV.openaiNextBaseUrl,
  textModel: ENV.openaiNextTextModel,
  api302Key: ENV.api302Key,
  api302BaseUrl: ENV.api302BaseUrl,
  llmModel: ENV.llmModel,
};

const NEXT_URL = 'https://api.openai-next.com/v1/chat/completions';
const LEGACY_URL = 'https://api.302.ai/v1/chat/completions';

/**
 * 这个服务不再有 `invokeLLM` 这个接缝——供应商选择和网络执行都归
 * inferenceOrchestrator。因此这里改在真正的传输层（fetch）打桩，顺带把
 * 实际发出的 payload 也纳入断言范围。
 */
function stubTransport(
  responder: (index: number) => unknown | Promise<unknown>
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const index = calls.length;
    calls.push({ url: String(url), init: init ?? {} });
    const body = await responder(index);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function stubTransportFailure(status = 500) {
  const calls: Array<{ url: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      calls.push({ url: String(url) });
      return new Response(JSON.stringify({ error: {} }), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    })
  );
  return calls;
}

function sentBody(init: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init.body));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDiff(overrides?: Partial<EditDiff>): EditDiff {
  return {
    cards: { deleted: [], added: [], modified: [] },
    script: { deleted: [], added: [], modified: [] },
    shots: { deleted: [], added: [], modified: [] },
    ...overrides,
  };
}

function makeLLMResponse(factualChanges: string[], inferredPreferences: string[]) {
  return {
    id: 'mock',
    created: 0,
    model: 'mock',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant' as const,
          content: JSON.stringify({ factualChanges, inferredPreferences }),
        },
        finish_reason: 'stop',
      },
    ],
  };
}

function makeAnnotation(overrides?: Partial<SemanticAnnotation>): SemanticAnnotation {
  return {
    id: 1,
    snapshotId: 10,
    previousSnapshotId: null,
    factualChanges: '[]',
    inferredPreferences: '[]',
    timestamp: new Date(),
    status: 'active',
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('generateAnnotation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCircuitBreaker();
    // 默认「Next 未配置」，让回退通道成为被测路径；需要 Next 的用例自行打开。
    ENV.openaiNextApiKey = '';
    ENV.openaiNextBaseUrl = 'https://api.openai-next.com';
    ENV.openaiNextTextModel = 'gpt-5.6-terra';
    ENV.api302Key = 'test-302-key';
    ENV.api302BaseUrl = 'https://api.302.ai';
    ENV.llmModel = 'legacy-text-model';
  });

  afterEach(() => {
    Object.assign(ENV, {
      openaiNextApiKey: originalOpenAINext.apiKey,
      openaiNextBaseUrl: originalOpenAINext.baseUrl,
      openaiNextTextModel: originalOpenAINext.textModel,
      api302Key: originalOpenAINext.api302Key,
      api302BaseUrl: originalOpenAINext.api302BaseUrl,
      llmModel: originalOpenAINext.llmModel,
    });
    vi.unstubAllGlobals();
  });

  it('routes semantic annotation through OpenAI Next when configured', async () => {
    ENV.openaiNextApiKey = 'test-next-key';
    const calls = stubTransport(() =>
      makeLLMResponse(['修改了故事文字'], ['偏好更克制的表达'])
    );
    mockCreateAnnotation.mockResolvedValueOnce(makeAnnotation({ status: 'active' }));

    const result = await generateAnnotation({
      diff: makeDiff(),
      snapshotId: 10,
      previousSnapshotId: 5,
      previousAnnotations: [],
    });

    expect(result.status).toBe('active');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(NEXT_URL);
    expect(
      (calls[0].init.headers as Record<string, string>).authorization
    ).toBe('Bearer test-next-key');

    const body = sentBody(calls[0].init);
    expect(body.model).toBe('gpt-5.6-terra');
    expect(body.max_completion_tokens).toBe(1024);
    expect(body.reasoning_effort).toBe('low');
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('falls back to the 302 gateway when Next is not configured', async () => {
    const calls = stubTransport(() => makeLLMResponse(['改了标题'], []));
    mockCreateAnnotation.mockResolvedValueOnce(makeAnnotation({ status: 'active' }));

    const result = await generateAnnotation({
      diff: makeDiff(),
      snapshotId: 10,
      previousSnapshotId: 5,
      previousAnnotations: [],
    });

    expect(result.status).toBe('active');
    expect(calls[0].url).toBe(LEGACY_URL);
    const body = sentBody(calls[0].init);
    expect(body.model).toBe('legacy-text-model');
    // 未登记的旧模型只收最小兼容字段，不会被塞进 Next 档位的参数
    expect(body.max_tokens).toBe(1024);
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('returns LLM-generated annotation on success', async () => {
    const savedAnnotation = makeAnnotation({
      factualChanges: JSON.stringify(['删除了 2 张卡片']),
      inferredPreferences: JSON.stringify(['倾向于克制的情感表达']),
      status: 'active',
    });
    stubTransport(() =>
      makeLLMResponse(['删除了 2 张卡片'], ['倾向于克制的情感表达'])
    );
    mockCreateAnnotation.mockResolvedValueOnce(savedAnnotation);

    const result = await generateAnnotation({
      diff: makeDiff({
        cards: {
          deleted: [{ id: '1', title: '伤感' }, { id: '2', title: '思念' }],
          added: [],
          modified: [],
        },
      }),
      snapshotId: 10,
      previousSnapshotId: 5,
      previousAnnotations: [],
    });

    expect(result.status).toBe('active');
    expect(mockCreateAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotId: 10,
        previousSnapshotId: 5,
        status: 'active',
        factualChanges: JSON.stringify(['删除了 2 张卡片']),
        inferredPreferences: JSON.stringify(['倾向于克制的情感表达']),
      }),
    );
  });

  it('passes previous annotations to LLM for continuity', async () => {
    const prevAnnotation = makeAnnotation({
      factualChanges: JSON.stringify(['修改了对白']),
      inferredPreferences: JSON.stringify(['偏好简洁对白']),
    });
    const calls = stubTransport(() => makeLLMResponse(['删除了场景'], []));
    mockCreateAnnotation.mockResolvedValueOnce(makeAnnotation());

    await generateAnnotation({
      diff: makeDiff(),
      snapshotId: 11,
      previousSnapshotId: 10,
      previousAnnotations: [prevAnnotation],
    });

    const messages = sentBody(calls[0].init).messages as Array<{
      role: string;
      content: string;
    }>;
    const userMessage = messages.find((m) => m.role === 'user');
    expect(typeof userMessage?.content).toBe('string');
    expect(userMessage?.content).toContain('偏好简洁对白');
  });

  it('falls back to raw diff summary on malformed LLM JSON', async () => {
    stubTransport(() => ({
      id: 'mock',
      created: 0,
      model: 'mock',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'not valid json {{{' },
          finish_reason: 'stop',
        },
      ],
    }));
    const fallbackAnnotation = makeAnnotation({ status: 'pending' });
    mockCreateAnnotation.mockResolvedValueOnce(fallbackAnnotation);

    const result = await generateAnnotation({
      diff: makeDiff({ cards: { deleted: [{ id: '1' }], added: [], modified: [] } }),
      snapshotId: 10,
      previousSnapshotId: 5,
      previousAnnotations: [],
    });

    expect(result.status).toBe('pending');
    expect(mockCreateAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending',
        inferredPreferences: JSON.stringify([]),
      }),
    );
  });

  it('falls back when LLM response is missing required arrays', async () => {
    // valid JSON but wrong structure
    stubTransport(() => ({
      id: 'mock',
      created: 0,
      model: 'mock',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: JSON.stringify({ result: 'ok' }) },
          finish_reason: 'stop',
        },
      ],
    }));
    const fallbackAnnotation = makeAnnotation({ status: 'pending' });
    mockCreateAnnotation.mockResolvedValueOnce(fallbackAnnotation);

    const result = await generateAnnotation({
      diff: makeDiff(),
      snapshotId: 10,
      previousSnapshotId: 5,
      previousAnnotations: [],
    });

    expect(result.status).toBe('pending');
  });

  it('falls back on LLM call rejection', async () => {
    stubTransportFailure(500);
    const fallbackAnnotation = makeAnnotation({ status: 'pending' });
    mockCreateAnnotation.mockResolvedValueOnce(fallbackAnnotation);

    const result = await generateAnnotation({
      diff: makeDiff(),
      snapshotId: 10,
      previousSnapshotId: 5,
      previousAnnotations: [],
    });

    expect(result.status).toBe('pending');
  });

  it('opens circuit breaker after 3 consecutive failures', async () => {
    const fallbackAnnotation = makeAnnotation({ status: 'pending' });
    stubTransportFailure(500);
    mockCreateAnnotation.mockResolvedValue(fallbackAnnotation);

    const diff = makeDiff();
    const base = { snapshotId: 10, previousSnapshotId: 5, previousAnnotations: [] };

    await generateAnnotation({ diff, ...base });
    await generateAnnotation({ diff, ...base });
    expect(isCircuitOpen()).toBe(false);

    await generateAnnotation({ diff, ...base });
    expect(isCircuitOpen()).toBe(true);
  });

  it('skips LLM call when circuit breaker is open', async () => {
    const fallbackAnnotation = makeAnnotation({ status: 'pending' });
    stubTransportFailure(500);
    mockCreateAnnotation.mockResolvedValue(fallbackAnnotation);

    // Trip the breaker
    const diff = makeDiff();
    const base = { snapshotId: 10, previousSnapshotId: 5, previousAnnotations: [] };
    await generateAnnotation({ diff, ...base });
    await generateAnnotation({ diff, ...base });
    await generateAnnotation({ diff, ...base });
    expect(isCircuitOpen()).toBe(true);

    vi.clearAllMocks();
    // 重新打桩：断路器打开后一次网络调用都不该发生
    const callsAfterOpen = stubTransportFailure(500);
    mockCreateAnnotation.mockResolvedValue(fallbackAnnotation);

    await generateAnnotation({ diff, ...base });

    expect(callsAfterOpen).toHaveLength(0);
    expect(mockCreateAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
    );
  });

  it('resets circuit breaker on successful annotation', async () => {
    const fallbackAnnotation = makeAnnotation({ status: 'pending' });
    stubTransportFailure(500);
    mockCreateAnnotation.mockResolvedValue(fallbackAnnotation);

    // Trip the breaker
    const diff = makeDiff();
    const base = { snapshotId: 10, previousSnapshotId: 5, previousAnnotations: [] };
    await generateAnnotation({ diff, ...base });
    await generateAnnotation({ diff, ...base });
    await generateAnnotation({ diff, ...base });
    expect(isCircuitOpen()).toBe(true);

    // Simulate cooldown by resetting manually (would naturally expire in 10 min)
    resetCircuitBreaker();
    expect(isCircuitOpen()).toBe(false);

    // Successful call
    stubTransport(() => makeLLMResponse(['变更'], ['偏好']));
    mockCreateAnnotation.mockResolvedValueOnce(makeAnnotation({ status: 'active' }));

    const result = await generateAnnotation({ diff, ...base });
    expect(result.status).toBe('active');
    expect(isCircuitOpen()).toBe(false);
  });

  it('fallback diff summary lists all change types', async () => {
    stubTransportFailure(500);
    mockCreateAnnotation.mockImplementationOnce(async (data) => makeAnnotation(data as Partial<SemanticAnnotation>));

    await generateAnnotation({
      diff: makeDiff({
        cards: { deleted: [{ id: '1' }], added: [{ id: '2' }], modified: [] },
        shots: { deleted: [], added: [], modified: [{ old: { shotNo: 1 }, new: { shotNo: 1, shotType: 'close' } }] },
      }),
      snapshotId: 10,
      previousSnapshotId: 5,
      previousAnnotations: [],
    });

    const call = mockCreateAnnotation.mock.calls[0][0];
    const facts = JSON.parse(call.factualChanges as string) as string[];
    expect(facts.some((f) => f.includes('删除了 1 张卡片'))).toBe(true);
    expect(facts.some((f) => f.includes('新增了 1 张卡片'))).toBe(true);
    expect(facts.some((f) => f.includes('修改了 1 个镜头'))).toBe(true);
  });
});
