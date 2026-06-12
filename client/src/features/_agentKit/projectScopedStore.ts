/**
 * 前端 Agent 脚手架 —— 按 projectId 分区的 localStorage 持久化
 *
 * 每个前端 Agent（creationAgent / storyAgent…）都要把自己的会话状态按 projectId
 * 存进 localStorage、刷新后恢复、切项目时换分区。把这套读写收成一处，
 * 新增前端 Agent 时直接复用，不必再抄一遍 storageKey / try-catch / 分区逻辑。
 *
 * 这是纯函数（不依赖 React），便于单测；React 那层只需在 effect 里调用即可。
 */

/** 按前缀 + projectId 组出存储键；projectId 为空（无项目）时返回 null（不存储） */
export function makeStorageKey(
  prefix: string,
  projectId: number | null,
): string | null {
  return projectId ? `${prefix}:${projectId}` : null;
}

/**
 * 读取并解析某项目的持久化状态。
 * @param parse    把 JSON.parse 后的值规范化成 T（各 Agent 自定，容错由调用方负责）
 * @param fallback 无数据 / 无项目 / 解析失败时的安全默认
 */
export function loadProjectState<T>(
  prefix: string,
  projectId: number | null,
  parse: (raw: unknown) => T,
  fallback: () => T,
): T {
  const key = makeStorageKey(prefix, projectId);
  if (!key) return fallback();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback();
    return parse(JSON.parse(raw));
  } catch {
    return fallback();
  }
}

/** 写入某项目的持久化状态；无项目则跳过，写入失败（如配额超限）静默忽略。 */
export function saveProjectState<T>(
  prefix: string,
  projectId: number | null,
  state: T,
): void {
  const key = makeStorageKey(prefix, projectId);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* 配额超限等 — 非关键，忽略 */
  }
}
