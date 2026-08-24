import type { VisualEditDocument } from "../../shared/visualClipModel";

/**
 * 视觉剪辑的撤销日志。
 *
 * 为什么在服务端：以前撤销是客户端把一份完整的 items 数组写回去——那本身
 * 就是一个整份写入口。只要它还在，「一个事实一个权威 writer」就没真正做到，
 * 用户也仍然可能因为两条写路径打架而遇到「撤销之后位置又跳回去」。
 * 现在客户端只说「撤销」，回退由服务端自己完成。
 *
 * 为什么放内存而不是写进 timeline 文档：文档里塞 N 份完整 items 快照，
 * 正是这个项目 2026-07-08 栽过的雪球——谱系文件涨到 383MB、启动直接 OOM。
 * 撤销历史是会话尺度的东西，不值得用那个代价换持久化。
 *
 * 代价说清楚：服务进程重启后撤销历史清空。开发机上 `tsx watch` 改一次
 * 服务端文件就会重启，所以本地开发时这件事会比线上明显。
 */

export type VisualEditUndoEntry = {
  /** 命令执行前的完整文档，回退时原样写回。 */
  before: VisualEditDocument;
};

/** 与客户端撤销栈保持同一深度。 */
const MAX_UNDO_STEPS = 40;

const journalByScope = new Map<string, VisualEditUndoEntry[]>();

function scopeKey(storyId: number, userId: number): string {
  // 带上 userId：撤销栈绝不能跨用户串，哪怕 storyId 被猜中。
  return `${userId}:${storyId}`;
}

/** 深拷贝一份，免得后续对同一对象的修改污染已经记下的历史。 */
function cloneDocument(document: VisualEditDocument): VisualEditDocument {
  return structuredClone(document) as VisualEditDocument;
}

export function recordVisualEditUndo(input: {
  storyId: number;
  userId: number;
  before: VisualEditDocument;
}): void {
  const key = scopeKey(input.storyId, input.userId);
  const stack = journalByScope.get(key) ?? [];
  stack.push({ before: cloneDocument(input.before) });
  if (stack.length > MAX_UNDO_STEPS) {
    stack.splice(0, stack.length - MAX_UNDO_STEPS);
  }
  journalByScope.set(key, stack);
}

export function takeVisualEditUndo(input: {
  storyId: number;
  userId: number;
}): VisualEditUndoEntry | null {
  const key = scopeKey(input.storyId, input.userId);
  const stack = journalByScope.get(key);
  const entry = stack?.pop() ?? null;
  if (stack && stack.length === 0) journalByScope.delete(key);
  return entry;
}

/** 还剩几步可撤销——界面用它决定按钮灰不灰。 */
export function visualEditUndoDepth(input: {
  storyId: number;
  userId: number;
}): number {
  return journalByScope.get(scopeKey(input.storyId, input.userId))?.length ?? 0;
}

export function clearVisualEditUndoForTesting(): void {
  journalByScope.clear();
}
