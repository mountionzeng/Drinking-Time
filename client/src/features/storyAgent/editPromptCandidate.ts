/**
 * 阶段 D：直接编辑镜头表字段（故事板的 Storyboard 表格，不经过提示词数据库）
 * 时，额外提议一条提示词候选——跟阶段 C 的聊天触发候选是同一套基础设施
 * （findPromptLineageNode / buildPromptAttribution / findSupersedableCandidate）。
 *
 * 刻意不改变镜头表保存本身的行为——字段照常立即生效、立即持久化，不因为
 * 这个候选机制而多一道等待或确认关卡。候选是叠加的信号，用来让谱系编译出的
 * 最终提示词能追上镜头表已经改成什么样，同不同步由用户在故事板上自己确认。
 *
 * ## 只在谱系"冻结"之后才提议（浏览器实测修正的设计前提）
 *
 * 阶段 D 最初的前提是"直接改镜头表会完全绕过谱系，不产生任何结构化信号"。
 * 实测证明这个前提对**全新故事**是错的：服务端 getStoryProjection 会先跑
 * maybeResetStaleMigration——只要 stories.body 变了、且谱系里还没有任何
 * user/agent 修订，它就会整个清空重建谱系，把新的 body 值直接吸收成新基线。
 * 也就是说这种情况下谱系**会自动跟上**，再提一条候选既是多余的（内容跟已确认
 * 内容完全一样），也是不可能的（重建会销毁 nodeId，createCandidate 报
 * "Prompt node N is unavailable"）。
 *
 * 真正需要候选的是另一半情况：一旦故事有过人工提示词修改（阶段 B 的手改、
 * 阶段 C 的聊天候选、划词编辑……），`hasManualPromptEdits` 为真，服务端就
 * **不再自动重建**，谱系从此冻结。这之后镜头表的改动才会和谱系真正分叉，
 * 候选也才有意义、nodeId 也才稳定。
 *
 * 所以这里用 {@link lineageWillAutoResync} 复刻服务端那个判断：会自动同步的
 * 就不提议，交给服务端自己重建。
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
 * 复刻服务端 `maybeResetStaleMigration` 的判断：谱系里一旦有任何 user/agent
 * 修订，服务端就停止自动重建；在那之前，body 一变谱系就整个重来。
 *
 * 返回 true 表示"服务端会自己把这次改动吸收进谱系"，此时不该提候选。
 * 判断条件跟服务端 `hasManualPromptEdits` 保持一致——两边不同步的话，
 * 症状是 createCandidate 报 "Prompt node N is unavailable"（节点已被重建销毁）。
 */
export function lineageWillAutoResync(aggregate: StoryPromptAggregate): boolean {
  return !aggregate.revisions.some(
    revision => revision.authorType === "user" || revision.authorType === "agent",
  );
}

/**
 * 把一批镜头表字段改动解析成可执行的候选计划。会被安静跳过的情况都不是
 * 错误：谱系还会自动重建（见 {@link lineageWillAutoResync}）、字段不是已知
 * 提示词维度（比如 cueCode/note 这类纯记录字段）、镜头还没有稳定身份、
 * 值其实没变、或者这个维度在谱系里还没有对应节点（未迁移的旧故事）。
 */
export function resolveEditCandidatePlans(input: {
  changes: readonly ShotFieldChange[];
  aggregate: StoryPromptAggregate;
}): EditCandidatePlan[] {
  // 谱系还会自动跟上 body 的话，提候选既多余又会撞上节点重建。
  if (lineageWillAutoResync(input.aggregate)) return [];

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
