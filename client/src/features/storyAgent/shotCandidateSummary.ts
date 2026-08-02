/**
 * 阶段 E：把提示词谱系聚合，压成"这个镜头有几条待确认候选、分别是什么"的
 * 摘要——喂给故事板每个镜头卡片上的提醒徽章。纯函数，不碰网络。
 *
 * 刻意只统计镜头局部节点（node.stableShotId === 这个镜头），不下钻故事级
 * 共享节点（scope: "story"，比如整体视觉风格）——那些候选一次性影响所有
 * 镜头，摊到每张镜头卡片上重复显示 N 次会显得候选比实际更多、也找不到
 * "这一条该在哪确认"的直觉位置。故事级候选留给专门的入口（不在这一步）。
 */
import type { StoryPromptAggregate, PromptRevision, PromptNode } from "@shared/promptLineage";
import { promptDimensionLabel } from "@shared/promptDimensions";
import {
  decodeAttributionReason,
  describeAttribution,
} from "@shared/promptRevisionAttribution";

export type ShotPendingCandidate = {
  revisionId: number;
  nodeId: number;
  dimension: string;
  /** 优先取维度的中文标签，查不到就退回维度 id 本身。 */
  label: string;
  /** 谱系里当前已确认的内容；节点还没有确认过内容时为 null。 */
  currentContent: string | null;
  /** 候选修订的内容——确认后会成为新的当前内容。 */
  proposedContent: string;
  /** 人类可读的一句话来源摘要，如"2 条聊天证据"；解不出归因时为 null。 */
  attributionSummary: string | null;
};

function confirmedContent(
  node: PromptNode,
  revisionsById: Map<number, PromptRevision>,
): string | null {
  if (node.currentRevisionId == null) return null;
  return revisionsById.get(node.currentRevisionId)?.content ?? null;
}

/**
 * 按 stableShotId 分组，返回每个镜头的待确认候选列表（可能为空数组）。
 * 用 Map 而不是"按镜头查一次"的函数，是因为故事板一次要给所有镜头都
 * 算一遍，批量算一次比每张卡片各自遍历 revisions 更省。
 */
export function summarizeShotCandidates(
  aggregate: StoryPromptAggregate | null | undefined,
): Map<string, ShotPendingCandidate[]> {
  const summary = new Map<string, ShotPendingCandidate[]>();
  if (!aggregate) return summary;

  const nodesById = new Map(aggregate.nodes.map(node => [node.id, node]));
  const revisionsById = new Map(aggregate.revisions.map(rev => [rev.id, rev]));

  for (const revision of aggregate.revisions) {
    if (revision.status !== "candidate") continue;
    const node = nodesById.get(revision.nodeId);
    if (!node || node.scope === "story" || !node.stableShotId) continue;

    const attribution = decodeAttributionReason(revision.reason);
    const entry: ShotPendingCandidate = {
      revisionId: revision.id,
      nodeId: node.id,
      dimension: node.dimension,
      label: promptDimensionLabel(node.dimension) ?? node.dimension,
      currentContent: confirmedContent(node, revisionsById),
      proposedContent: revision.content,
      attributionSummary: attribution ? describeAttribution(attribution) : null,
    };

    const list = summary.get(node.stableShotId);
    if (list) list.push(entry);
    else summary.set(node.stableShotId, [entry]);
  }

  return summary;
}
