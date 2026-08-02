/**
 * 结构化归因 —— 把「这条候选修订为什么存在」从自由文本变成可解析、可按维度
 * 聚合的数据。
 *
 * ## 背景
 *
 * `promptRevisions.reason` 一直是自由文本，两条现有生产路径已经在用事实上的
 * 约定（`xiaozhuo-selection:${sourceType}:${sourceId}`、
 * `creation-editor:${dimension}`），只是没有结构、无法解析。这一步把约定
 * 升级成真正的类型，为后续「按维度统计候选/编辑证据」（阶段 C/D）打地基。
 *
 * ## 为什么编码进 `reason` 而不是新开一列
 *
 * `reason` 目前没有任何 UI 读取或展示（已核实），只被写入端消费——升级它的
 * 内容格式不影响任何现有展示，也不需要 additive migration 去碰
 * `prompt_revisions` 表（以及它在本地 JSON 持久化里的镜像）。本地持久化文件
 * 曾因为数据无节制增长导致启动 OOM（2026-07-08 事故），在没有真实用量数据
 * 判断「要不要一张独立的可查询表」之前，先选风险最小的落点。如果阶段 C/D
 * 跑起来后发现需要 SQL 侧聚合，再单独评审升级成专用列/表——那是数据决策，
 * 不该在这一步顺带做掉。
 *
 * 用带版本号的前缀区分「这是结构化归因」还是「历史自由文本」
 * （"legacy import"、"restore revision 5" 这类），前缀不匹配一律当作
 * 未结构化，不强行解析、不抛错。
 */

import { canonicalDimension } from "./promptDimensions";

const ATTRIBUTION_PREFIX = "prompt-attribution/v1:";

/**
 * 阶段 C（普通聊天消息触发候选）里，小酌被允许提议修改的维度——刻意收窄到
 * 叙事内容类，不包含运镜/负面提示/美术配方这类需要专门界面操作的维度。
 * 聊天里随口一句话就能改变镜头的机位角度，用户体验上会很奇怪；这些维度
 * 仍然可以通过划词编辑（selection）或提示词数据库手改（manual）触达。
 */
export const UTTERANCE_ELIGIBLE_DIMENSIONS: readonly string[] = [
  "subject",
  "action",
  "dialogue",
  "location",
  "mood",
  "style_reference",
  "time_light",
];

/** 证据来源类型；不同类型对应不同的产生路径。 */
export type PromptAttributionKind =
  /** 阶段 C：普通聊天消息（没有划词/选中对象）触发的候选 */
  | "utterance"
  /** 阶段 D：编辑快照 diff 推断出的偏好触发的候选 */
  | "edit"
  /** 现有：划词/选中对象 + 指令触发的候选（StoryAgentContext.sendSelectionEdit） */
  | "selection"
  /** 现有：直接在提示词数据库/表格里手改一行触发的候选（PromptTablePanel） */
  | "manual";

/** 证据摘录的长度上限——归因是为了留痕，不是为了把整段对话都存进 reason。 */
const EXCERPT_MAX_LENGTH = 200;

export type PromptAttributionEvidence = {
  kind: PromptAttributionKind;
  /** ISO 时间戳 */
  at: string;
  /** 触发这条证据的对话消息 id（utterance / selection 来源） */
  messageId?: string;
  /** 触发这条证据的编辑快照 id（edit 来源） */
  snapshotId?: number;
  /** 划词/选中的对象类型，如 "storyboard-image" / "shot"（selection 来源） */
  sourceType?: string;
  sourceId?: string;
  /** 驱动这次修改的原始用户文字，截断到 {@link EXCERPT_MAX_LENGTH} */
  excerpt?: string;
};

export type PromptRevisionAttribution = {
  /** 规范维度 id（已经过 canonicalDimension() 归一），用于按维度聚合统计 */
  dimension: string;
  evidence: PromptAttributionEvidence[];
};

function truncateExcerpt(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.length > EXCERPT_MAX_LENGTH
    ? `${trimmed.slice(0, EXCERPT_MAX_LENGTH)}…`
    : trimmed;
}

/**
 * 构造一条证据。`dimension` 会被归一到规范 id——调用方不需要自己先查
 * `canonicalDimension()`，传原始写法（camelCase/镜头字段名）也安全。
 */
export function buildPromptAttribution(input: {
  dimension: string;
  kind: PromptAttributionKind;
  at?: Date | string;
  messageId?: string;
  snapshotId?: number;
  sourceType?: string;
  sourceId?: string;
  excerpt?: string;
}): PromptRevisionAttribution {
  const at =
    input.at instanceof Date
      ? input.at.toISOString()
      : (input.at ?? new Date().toISOString());
  return {
    dimension: canonicalDimension(input.dimension),
    evidence: [
      {
        kind: input.kind,
        at,
        messageId: input.messageId,
        snapshotId: input.snapshotId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        excerpt: truncateExcerpt(input.excerpt),
      },
    ],
  };
}

/** 累积证据的上限——避免同一个候选被反复覆盖时证据数组无节制增长。 */
const MAX_EVIDENCE_ITEMS = 8;

/**
 * 把新证据合并进已有归因（同一维度时），用于"同一维度的候选不重复开新的，
 * 而是在已有候选上累积证据"。维度不同时说明目标变了，直接返回新归因，
 * 不强行合并两件不相关的事。证据数超过上限时只保留最近的
 * {@link MAX_EVIDENCE_ITEMS} 条——最新的证据最能说明"为什么现在还成立"。
 */
export function mergeAttributionEvidence(
  previous: PromptRevisionAttribution | null,
  next: PromptRevisionAttribution,
): PromptRevisionAttribution {
  if (!previous || previous.dimension !== next.dimension) return next;
  const evidence = [...previous.evidence, ...next.evidence].slice(-MAX_EVIDENCE_ITEMS);
  return { dimension: next.dimension, evidence };
}

/** 编码成可以存进 `promptRevisions.reason`（text 列）的字符串。 */
export function encodeAttributionReason(
  attribution: PromptRevisionAttribution,
): string {
  return `${ATTRIBUTION_PREFIX}${JSON.stringify(attribution)}`;
}

function isValidEvidence(value: unknown): value is PromptAttributionEvidence {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.kind === "string" && typeof v.at === "string";
}

/**
 * 从 `reason` 字符串解析结构化归因。非结构化的历史文本（"legacy import"、
 * "restore revision 5"、用户/agent 自己写的自由文本）一律返回 null——
 * 从不抛错，因为这一列历史上什么都可能存过。
 */
export function decodeAttributionReason(
  reason: string | null | undefined,
): PromptRevisionAttribution | null {
  if (!reason || !reason.startsWith(ATTRIBUTION_PREFIX)) return null;
  try {
    const parsed = JSON.parse(reason.slice(ATTRIBUTION_PREFIX.length));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.dimension !== "string" ||
      !Array.isArray(parsed.evidence) ||
      !parsed.evidence.every(isValidEvidence)
    ) {
      return null;
    }
    return parsed as PromptRevisionAttribution;
  } catch {
    return null;
  }
}

const KIND_LABELS: Record<PromptAttributionKind, string> = {
  utterance: "聊天",
  edit: "编辑",
  selection: "划词编辑",
  manual: "手改",
};

/**
 * 人类可读的一句话摘要，例如「根据 2 条聊天证据 · 最近一次于 xxx」。
 * 目前没有 UI 消费——留给阶段 E（故事板显示候选）用，先把函数写对。
 */
export function describeAttribution(
  attribution: PromptRevisionAttribution,
): string {
  const byKind = new Map<PromptAttributionKind, number>();
  for (const item of attribution.evidence) {
    byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1);
  }
  const parts = Array.from(byKind.entries()).map(
    ([kind, count]) => `${count} 条${KIND_LABELS[kind]}证据`,
  );
  return parts.length > 0 ? parts.join(" + ") : "无证据记录";
}
