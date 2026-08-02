/**
 * 阶段 D：直接编辑镜头表字段（故事板的 Storyboard 表格，不经过提示词数据库）
 * 时，额外提议一条提示词候选——跟阶段 C 的聊天触发候选是同一套基础设施
 * （findPromptLineageNode / buildPromptAttribution / findSupersedableCandidate），
 * 只是触发方式不同：这里不需要判断"有没有新信息"（用户已经明确改了这个
 * 字段，改动本身就是信号），只需要判断"这个字段是不是一个已知的提示词维度、
 * 这个镜头有没有对应的谱系节点"。
 *
 * 刻意不改变 updateStoryShotField 本身的行为——镜头表字段照常立即生效、
 * 立即持久化，不因为这个候选机制而多一道等待或确认关卡。候选是叠加的
 * 信号，用来让谱系编译出的最终提示词能追上镜头表已经改成什么样，同不
 * 同步、什么时候同步仍由用户在故事板上自己确认。
 */
import type { StoryPromptAggregate } from "@shared/promptLineage";
import { canonicalDimension, isKnownDimension } from "@shared/promptDimensions";
import {
  buildPromptAttribution,
  decodeAttributionReason,
  encodeAttributionReason,
  mergeAttributionEvidence,
} from "@shared/promptRevisionAttribution";
import { findPromptLineageNode } from "./selectionPromptCandidate";
import { findSupersedableCandidate } from "./promptCandidateSupersede";

export type ShotFieldChange = {
  /** 目标镜头的稳定身份——找不到就跳过，未迁移/新建镜头没有这个字段是正常情况。 */
  stableShotId: string | null | undefined;
  /** 编辑前的字段值，用来判断"是不是真的改了"。 */
  previousValue: string | undefined;
  /** 编辑后的字段值。 */
  nextValue: string;
  /** 镜头表字段名（camelCase，如 styleRef/cameraMove），会被归一到规范维度 id。 */
  field: string;
};

export type EditCandidatePlan = {
  nodeId: number;
  stableShotId: string;
  dimension: string;
  content: string;
  /** 已编码好、可以直接传给 createCandidate 的 reason（已合并旧证据，若有）。 */
  reason: string;
  /** 若非空，说明这个节点上已有一条本模块产生的待确认候选，需要先 reject 掉它再建新的。 */
  supersedesRevisionId?: number;
};

/**
 * 把一批镜头表字段改动解析成可执行的候选计划。会被安静跳过的情况都不是
 * 错误：字段不是已知提示词维度（比如 cueCode/note 这类纯记录字段）、
 * 镜头还没有稳定身份、值其实没变、或者这个维度在谱系里还没有对应节点
 * （未迁移的旧故事）。
 */
export function resolveEditCandidatePlans(input: {
  changes: readonly ShotFieldChange[];
  aggregate: StoryPromptAggregate;
}): EditCandidatePlan[] {
  const plans: EditCandidatePlan[] = [];
  for (const change of input.changes) {
    const stableShotId = change.stableShotId?.trim();
    if (!stableShotId) continue;

    const nextValue = change.nextValue.trim();
    if (!nextValue) continue;
    if (nextValue === (change.previousValue ?? "").trim()) continue;

    const dimension = canonicalDimension(change.field);
    if (!isKnownDimension(dimension)) continue;

    const found = findPromptLineageNode({ aggregate: input.aggregate, dimension, stableShotId });
    if (!found) continue;
    // 谱系里已经是这个值了（比如故事迁移后镜头表字段又被单独改回旧内容）——
    // 没有实质差异，不必再提议一次。
    if ((found.currentContent ?? "").trim() === nextValue) continue;

    const supersedes = findSupersedableCandidate(input.aggregate.revisions, found.nodeId, "edit");
    const previousAttribution = supersedes ? decodeAttributionReason(supersedes.reason) : null;
    const nextAttribution = buildPromptAttribution({ dimension, kind: "edit" });
    const merged = mergeAttributionEvidence(previousAttribution, nextAttribution);

    plans.push({
      nodeId: found.nodeId,
      stableShotId,
      dimension,
      content: nextValue,
      reason: encodeAttributionReason(merged),
      supersedesRevisionId: supersedes?.id,
    });
  }
  return plans;
}
