/**
 * 共享的"候选去重"逻辑——多条触发路径（聊天提议 / 直接编辑 / 未来还会有的其它
 * 路径）都可能反复对同一个提示词节点提议修改。任何一条要是每次都无脑
 * createCandidate，几轮下来这个节点就会堆出一串几乎重复的候选，故事板会
 * 变成待办地狱。用这个函数在提议前先查"这个节点上是不是已经有一条本路径
 * 留下的、还没被确认/拒绝的候选"，有就顶掉重建（reject + create），证据
 * 累积合并，不留下越堆越多的候选行。
 */
import type { PromptRevision } from "@shared/promptLineage";
import {
  decodeAttributionReason,
  type PromptAttributionKind,
} from "@shared/promptRevisionAttribution";

/**
 * 只按 kind 匹配，不看 authorType——kind 已经是每条触发路径专属的标记
 * （utterance 只会被聊天路径写入、edit 只会被直接编辑路径写入……），足够
 * 精确区分"这是不是我自己这条路径留下的候选"，不会误顶掉其它路径产生的
 * 候选（比如用户在提示词数据库手改产生的 manual 候选、划词编辑产生的
 * selection 候选）。
 */
export function findSupersedableCandidate(
  revisions: readonly PromptRevision[],
  nodeId: number,
  kind: PromptAttributionKind,
): PromptRevision | null {
  for (const revision of revisions) {
    if (revision.nodeId !== nodeId) continue;
    if (revision.status !== "candidate") continue;
    const attribution = decodeAttributionReason(revision.reason);
    if (attribution?.evidence.some(e => e.kind === kind)) return revision;
  }
  return null;
}
