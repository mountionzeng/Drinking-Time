/**
 * 「确认一条候选」→「该往镜头表哪一列写什么」的解析。
 *
 * ## 这一步解决的问题
 *
 * 确认候选原本只改谱系（节点的 currentRevisionId 指向新修订）。但故事版出图读的是
 * `stories.body` 里的镜头字段，不读谱系——两条链路各有各的事实源。结果是聊天提议的
 * 候选哪怕被确认了，故事版重渲出来的图跟没确认完全一样，而且不报任何错。
 *
 * 所以确认时要把确认值同时写回镜头表，让两边收敛到同一个值。
 *
 * ## 刻意跳过的情况（都返回 null，都不是错误）
 *
 * - **故事级共享节点**（`scope === "story"`，没有 stableShotId）：它作用于全部镜头，
 *   没有唯一的落点列，硬写会挑错镜头。
 * - **维度在镜头表里没有对应列**：见 {@link shotFieldForDimension}。
 * - **确认值为空**：阶段 C/D 都不会产生空内容的候选，真出现空值更可能是数据异常而不是
 *   「用户想清空这一列」。回写会覆盖用户已有内容，这里选择不动它。
 */
import type { PromptNode, PromptRevision } from "./promptLineage";
import { shotFieldForDimension } from "./promptShotFields";
import type { StoryShotEditableField } from "./shotDirector";

export type CandidateWriteback = {
  stableShotId: string;
  field: StoryShotEditableField;
  value: string;
};

export function resolveCandidateWriteback(input: {
  nodes: readonly PromptNode[];
  candidate: Pick<PromptRevision, "nodeId" | "content">;
}): CandidateWriteback | null {
  const node = input.nodes.find(item => item.id === input.candidate.nodeId);
  if (!node) return null;

  const stableShotId = node.stableShotId?.trim();
  if (!stableShotId || node.scope === "story") return null;

  const field = shotFieldForDimension(node.dimension);
  if (!field) return null;

  const value = input.candidate.content.trim();
  if (!value) return null;

  return { stableShotId, field, value };
}
