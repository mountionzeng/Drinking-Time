import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateAnnotation, isCircuitOpen, resetCircuitBreaker } from './semanticAnnotation';
import type { EditDiff } from '../_core/editDiff';
import type { SemanticAnnotation } from '../db';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../_core/llm', () => ({
  invokeLLM: vi.fn(),
}));

vi.mock('../db', () => ({
  createSemanticAnnotation: vi.fn(),
}));

import { invokeLLM } from '../_core/llm';
import { createSemanticAnnotation } from '../db';

const mockInvokeLLM = vi.mocked(invokeLLM);
const mockCreateAnnotation = vi.mocked(createSemanticAnnotation);

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
  });

  it('returns LLM-generated annotation on success', async () => {
    const savedAnnotation = makeAnnotation({
      factualChanges: JSON.stringify(['删除了 2 张卡片']),
      inferredPreferences: JSON.stringify(['倾向于克制的情感表达']),
      status: 'active',
    });
    mockInvokeLLM.mockResolvedValueOnce(
      makeLLMResponse(['删除了 2 张卡片'], ['倾向于克制的情感表达']),
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
    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(['删除了场景'], []));
    mockCreateAnnotation.mockResolvedValueOnce(makeAnnotation());

    await generateAnnotation({
      diff: makeDiff(),
      snapshotId: 11,
      previousSnapshotId: 10,
      previousAnnotations: [prevAnnotation],
    });

    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const userMessage = callArgs.messages.find((m) => m.role === 'user');
    expect(typeof userMessage?.content).toBe('string');
    expect(userMessage?.content as string).toContain('偏好简洁对白');
  });

  it('falls back to raw diff summary on malformed LLM JSON', async () => {
    mockInvokeLLM.mockResolvedValueOnce({
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
    });
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
    mockInvokeLLM.mockResolvedValueOnce(
      // valid JSON but wrong structure
      {
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
      },
    );
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
    mockInvokeLLM.mockRejectedValueOnce(new Error('Network error'));
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
    mockInvokeLLM.mockRejectedValue(new Error('LLM down'));
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
    mockInvokeLLM.mockRejectedValue(new Error('LLM down'));
    mockCreateAnnotation.mockResolvedValue(fallbackAnnotation);

    // Trip the breaker
    const diff = makeDiff();
    const base = { snapshotId: 10, previousSnapshotId: 5, previousAnnotations: [] };
    await generateAnnotation({ diff, ...base });
    await generateAnnotation({ diff, ...base });
    await generateAnnotation({ diff, ...base });
    expect(isCircuitOpen()).toBe(true);

    vi.clearAllMocks();
    mockCreateAnnotation.mockResolvedValue(fallbackAnnotation);

    await generateAnnotation({ diff, ...base });

    // LLM should not have been called
    expect(mockInvokeLLM).not.toHaveBeenCalled();
    expect(mockCreateAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
    );
  });

  it('resets circuit breaker on successful annotation', async () => {
    const fallbackAnnotation = makeAnnotation({ status: 'pending' });
    mockInvokeLLM.mockRejectedValue(new Error('LLM down'));
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
    mockInvokeLLM.mockResolvedValueOnce(makeLLMResponse(['变更'], ['偏好']));
    mockCreateAnnotation.mockResolvedValueOnce(makeAnnotation({ status: 'active' }));

    const result = await generateAnnotation({ diff, ...base });
    expect(result.status).toBe('active');
    expect(isCircuitOpen()).toBe(false);
  });

  it('fallback diff summary lists all change types', async () => {
    mockInvokeLLM.mockRejectedValueOnce(new Error('fail'));
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
