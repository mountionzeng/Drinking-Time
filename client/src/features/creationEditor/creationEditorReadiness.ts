/**
 * 判断 CreationEditor 的当前 Story 作用域是否已经可信——即 StoryAgent spine
 * 已经把 activeStoryId / remoteStoryId 对齐到当前 activeId。不能用
 * shots.length > 0 判断，零镜头 Story 一旦作用域对齐也算已加载；反过来，
 * 切换 Story 期间旧作用域的镜头不能算 ready，哪怕它们已经在页面上。
 */
export function isStoryScopeReady(params: {
  activeId: number | null;
  spineActiveStoryId: number | null;
  spineRemoteStoryId: number | null | undefined;
}): boolean {
  const { activeId, spineActiveStoryId, spineRemoteStoryId } = params;
  if (activeId == null) return false;
  return spineActiveStoryId === activeId || spineRemoteStoryId === activeId;
}

/**
 * 核心 Story 数据（镜头、标题、时间线 fallback）是否还在初始恢复中。
 * 只反映 Story 作用域是否可信，不受素材、发布稿、提示词谱系或供应商状态
 * 等增强数据的加载状态影响——那些交给各自局部区域的 loading 展示。
 */
export function resolveInitialStoryLoading(params: {
  activeId: number | null;
  spineActiveStoryId: number | null;
  spineRemoteStoryId: number | null | undefined;
}): boolean {
  return !isStoryScopeReady(params);
}
