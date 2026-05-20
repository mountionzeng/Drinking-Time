/**
 * Semantic annotation service
 * Generates two-layer annotations (factual changes + inferred preferences) via LLM.
 * Falls back to raw diff summary on failure. Includes circuit breaker after 3 consecutive
 * failures (10-minute cooldown).
 */

import { invokeLLM } from '../_core/llm';
import { createSemanticAnnotation } from '../db';
import type { SemanticAnnotation } from '../db';
import { type EditDiff } from '../_core/editDiff';

const ANNOTATION_TIMEOUT_MS = 30_000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 10 * 60 * 1000;

// Circuit breaker state (module-level, resets on server restart)
let consecutiveFailures = 0;
let circuitBreakerOpenUntil: number | null = null;

export function isCircuitOpen(): boolean {
  if (circuitBreakerOpenUntil === null) return false;
  if (Date.now() >= circuitBreakerOpenUntil) {
    circuitBreakerOpenUntil = null;
    consecutiveFailures = 0;
    return false;
  }
  return true;
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  circuitBreakerOpenUntil = null;
}

function recordFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreakerOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    console.warn(
      `[semanticAnnotation] Circuit breaker opened after ${consecutiveFailures} consecutive failures`,
    );
  }
}

/** Reset circuit breaker — intended for testing only */
export function resetCircuitBreaker(): void {
  consecutiveFailures = 0;
  circuitBreakerOpenUntil = null;
}

function buildDiffSummary(diff: EditDiff): string[] {
  const changes: string[] = [];
  if (diff.cards.deleted.length > 0)
    changes.push(`删除了 ${diff.cards.deleted.length} 张卡片`);
  if (diff.cards.added.length > 0)
    changes.push(`新增了 ${diff.cards.added.length} 张卡片`);
  if (diff.cards.modified.length > 0)
    changes.push(`修改了 ${diff.cards.modified.length} 张卡片`);
  if (diff.script.deleted.length > 0)
    changes.push(`删除了 ${diff.script.deleted.length} 个剧本场景`);
  if (diff.script.added.length > 0)
    changes.push(`新增了 ${diff.script.added.length} 个剧本场景`);
  if (diff.script.modified.length > 0)
    changes.push(`修改了 ${diff.script.modified.length} 个剧本场景`);
  if (diff.shots.deleted.length > 0)
    changes.push(`删除了 ${diff.shots.deleted.length} 个镜头`);
  if (diff.shots.added.length > 0)
    changes.push(`新增了 ${diff.shots.added.length} 个镜头`);
  if (diff.shots.modified.length > 0)
    changes.push(`修改了 ${diff.shots.modified.length} 个镜头`);
  return changes.length > 0 ? changes : ['无明显内容变更'];
}

function buildUserPrompt(diff: EditDiff, previousAnnotations: SemanticAnnotation[], inlineCorrection?: InlineCorrection): string {
  // Trim diff to key fields to avoid bloating the prompt
  const diffSummary = {
    cards: {
      deleted: diff.cards.deleted.map((c) => ({ id: c.id, title: c.title, content: c.content })),
      added: diff.cards.added.map((c) => ({ id: c.id, title: c.title, content: c.content })),
      modified: diff.cards.modified.map((m) => ({
        id: m.old.id,
        from: { title: m.old.title, content: m.old.content },
        to: { title: m.new.title, content: m.new.content },
      })),
    },
    script: {
      deleted: diff.script.deleted.map((s) => ({ id: s.id, heading: s.heading })),
      added: diff.script.added.map((s) => ({ id: s.id, heading: s.heading })),
      modified: diff.script.modified.map((m) => ({
        id: m.old.id,
        from: { heading: m.old.heading, dialogue: m.old.dialogue },
        to: { heading: m.new.heading, dialogue: m.new.dialogue },
      })),
    },
    shots: {
      deleted: diff.shots.deleted.map((s) => ({ shotNo: s.shotNo, shotType: s.shotType })),
      added: diff.shots.added.map((s) => ({ shotNo: s.shotNo, shotType: s.shotType })),
      modified: diff.shots.modified.map((m) => ({
        shotNo: m.old.shotNo,
        from: { shotType: m.old.shotType, cameraAngle: m.old.cameraAngle },
        to: { shotType: m.new.shotType, cameraAngle: m.new.cameraAngle },
      })),
    },
  };

  let prompt = `以下是用户对项目内容的最新编辑变更：\n${JSON.stringify(diffSummary, null, 2)}\n`;

  if (inlineCorrection) {
    prompt += `\n【精准修正】用户主动选中并修改了一段文字：\n`;
    prompt += `- 来源类型：${inlineCorrection.sourceType}\n`;
    prompt += `- 原文：「${inlineCorrection.originalText}」\n`;
    prompt += `- 修改为：「${inlineCorrection.modifiedText}」\n`;
    prompt += `- 用户指令：${inlineCorrection.instruction}\n`;
    prompt += `这是最高质量的风格信号，请重点从这次修正推断偏好。\n`;
  }

  if (previousAnnotations.length > 0) {
    const recent = previousAnnotations.slice(0, 3);
    prompt += `\n近期的编辑注解历史（用于保持分析连贯性）：\n`;
    for (const ann of recent) {
      const facts = parseJsonField(ann.factualChanges);
      const prefs = parseJsonField(ann.inferredPreferences);
      prompt += `- 事实变更：${JSON.stringify(facts)}\n  推断偏好：${JSON.stringify(prefs)}\n`;
    }
  }

  prompt += `
请分析这些编辑，以 JSON 格式返回：
{
  "factualChanges": ["具体描述用户做了什么改动，如'删除了2张关于伤感主题的卡片'"],
  "inferredPreferences": ["从编辑行为推断的创作偏好，如'倾向于克制的情感表达风格'"]
}

注意：
- factualChanges 描述具体发生了什么（客观事实）
- inferredPreferences 推断用户的创作偏好（需要 2-3 个一致信号才能推断，信号不足则返回空数组）
- 仅返回 JSON，不要其他内容`;

  return prompt;
}

function parseJsonField(field: unknown): unknown {
  if (typeof field === 'string') {
    try {
      return JSON.parse(field);
    } catch {
      return field;
    }
  }
  return field;
}

export interface InlineCorrection {
  originalText: string;
  modifiedText: string;
  instruction: string;
  sourceType: string;
}

export interface GenerateAnnotationParams {
  diff: EditDiff;
  snapshotId: number;
  previousSnapshotId: number | null;
  previousAnnotations: SemanticAnnotation[];
  inlineCorrection?: InlineCorrection;
}

export async function generateAnnotation(
  params: GenerateAnnotationParams,
): Promise<SemanticAnnotation> {
  const { diff, snapshotId, previousSnapshotId, previousAnnotations, inlineCorrection } = params;

  if (isCircuitOpen()) {
    console.warn('[semanticAnnotation] Circuit breaker open, using fallback');
    return createFallbackAnnotation(diff, snapshotId, previousSnapshotId);
  }

  try {
    const llmPromise = invokeLLM({
      messages: [
        {
          role: 'system',
          content:
            '你是一位创意分析助手。通过分析用户对故事内容的编辑，推断其美学偏好和创作风格。仅返回 JSON。',
        },
        {
          role: 'user',
          content: buildUserPrompt(diff, previousAnnotations, inlineCorrection),
        },
      ],
      response_format: { type: 'json_object' },
      maxTokens: 1024,
      temperature: 0.3,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Annotation LLM timeout')),
        ANNOTATION_TIMEOUT_MS,
      ),
    );

    const result = await Promise.race([llmPromise, timeoutPromise]);
    const rawContent = result.choices[0]?.message?.content;
    const text = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
    const parsed = JSON.parse(text) as { factualChanges?: unknown; inferredPreferences?: unknown };

    if (!Array.isArray(parsed.factualChanges) || !Array.isArray(parsed.inferredPreferences)) {
      throw new Error('Invalid annotation response structure');
    }

    recordSuccess();

    return createSemanticAnnotation({
      snapshotId,
      previousSnapshotId,
      factualChanges: JSON.stringify(parsed.factualChanges),
      inferredPreferences: JSON.stringify(parsed.inferredPreferences),
      status: 'active',
    });
  } catch (error) {
    recordFailure();
    console.error('[semanticAnnotation] Annotation generation failed, using fallback:', error);
    return createFallbackAnnotation(diff, snapshotId, previousSnapshotId);
  }
}

async function createFallbackAnnotation(
  diff: EditDiff,
  snapshotId: number,
  previousSnapshotId: number | null,
): Promise<SemanticAnnotation> {
  return createSemanticAnnotation({
    snapshotId,
    previousSnapshotId,
    factualChanges: JSON.stringify(buildDiffSummary(diff)),
    inferredPreferences: JSON.stringify([]),
    status: 'pending',
  });
}
