/**
 * 阶段 C：把小酌在普通聊天（没有划词/选中对象）里提议的 proposePromptRevision
 * 工具调用，解析成"该对哪个提示词节点做什么"的纯计划——网络请求
 * （createCandidate / rejectCandidate）由调用方（StoryAgentContext）执行，
 * 这里只负责判断目标节点、要不要顶掉已有的同类候选、以及归因怎么合并。
 */
import type { StoryPromptAggregate } from "@shared/promptLineage";
import { canonicalDimension } from "@shared/promptDimensions";
import {
  buildPromptAttribution,
  decodeAttributionReason,
  encodeAttributionReason,
  mergeAttributionEvidence,
} from "@shared/promptRevisionAttribution";
import type { StoryShot } from "./types";
import { findPromptLineageNode } from "./selectionPromptCandidate";
import { findSupersedableCandidate } from "./promptCandidateSupersede";

/** 小酌吐出来的提议——形状和 server 的 ProposePromptRevisionToolCall 对齐，独立声明避免跨 server/client 边界导入类型。 */
export type ProposePromptRevisionLike = {
  name: string;
  shotNo?: number;
  dimension?: string;
  content?: string;
};

export type UtteranceCandidatePlan = {
  nodeId: number;
  stableShotId: string;
  dimension: string;
  content: string;
  /** 已编码好、可以直接传给 createCandidate 的 reason（已合并旧证据，若有）。 */
  reason: string;
  /** 若非空，说明这个节点上已有一条本模块产生的待确认候选，需要先 reject 掉它再建新的——同一维度只保留一条候选，不让聊几句就堆出一串。 */
  supersedesRevisionId?: number;
};

function shotIdentity(shot: StoryShot | undefined): string | null {
  return shot?.stableShotId?.trim() || shot?.shotIdentity?.trim() || null;
}

/**
 * 把一批 proposePromptRevision 工具调用解析成可执行的候选计划。
 * 找不到镜头 / 找不到对应提示词节点的条目会被安静丢弃（不是错误——
 * 未迁移到谱系的旧故事、或者镜头还没有这个维度的节点，都是正常情况）。
 */
export function resolveUtteranceCandidatePlans(input: {
  toolCalls: readonly ProposePromptRevisionLike[];
  shots: readonly StoryShot[];
  aggregate: StoryPromptAggregate;
  messageId: string;
  excerpt: string;
}): UtteranceCandidatePlan[] {
  const plans: UtteranceCandidatePlan[] = [];
  for (const tc of input.toolCalls) {
    if (tc.name !== "proposePromptRevision") continue;
    const content = tc.content?.trim();
    if (!content || tc.shotNo == null || !tc.dimension) continue;

    const shot = input.shots.find(s => s.shotNo === tc.shotNo);
    const stableShotId = shotIdentity(shot);
    if (!stableShotId) continue;

    const dimension = canonicalDimension(tc.dimension);
    const found = findPromptLineageNode({
      aggregate: input.aggregate,
      dimension,
      stableShotId,
    });
    if (!found) continue;

    const supersedes = findSupersedableCandidate(
      input.aggregate.revisions,
      found.nodeId,
      "utterance",
    );
    const previousAttribution = supersedes ? decodeAttributionReason(supersedes.reason) : null;
    const nextAttribution = buildPromptAttribution({
      dimension,
      kind: "utterance",
      messageId: input.messageId,
      excerpt: input.excerpt,
    });
    const merged = mergeAttributionEvidence(previousAttribution, nextAttribution);

    plans.push({
      nodeId: found.nodeId,
      stableShotId,
      dimension,
      content,
      reason: encodeAttributionReason(merged),
      supersedesRevisionId: supersedes?.id,
    });
  }
  return plans;
}
