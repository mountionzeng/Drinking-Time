import type { SelectionContext } from "@shared/selectionContext";

/**
 * 选区的故事归属。
 *
 * 2026-08-22：在「Codex消耗特别大」这个故事里看到了 `0402 · 主体 森林…` ——
 * 那是另一个故事的镜头。原因是切故事只重置了正文相关的字段，`activeSelection`
 * 一直留在原地：`clearCurrentStory()` 逐个清了 22 个字段但漏了它，而 `loadStory`
 * 压根不走 `clearCurrentStory`。于是从故事 A 换到故事 B，A 的选区还挂在输入框上，
 * 底下还写着「下一条消息会带着这个选区交给聊聊」。
 *
 * 光在切换处补一句清除是不够的——只要以后再多一条进入故事的路径，同样的漏法会
 * 再来一次。所以这里做成读取侧的兜底：storyId 对不上就当没有选区，不渲染也不发送。
 */
export function selectionBelongsToStory(
  selection: Pick<SelectionContext, "storyId"> | null | undefined,
  activeStoryId: number | null | undefined
): boolean {
  if (!selection) return false;
  // 早期选区（以及纯文本类选区）不带 storyId，无法证伪，按属于当前故事处理；
  // 真正会跨故事串台的镜头/图片/时间轴选区都由生产者写死了 storyId。
  if (selection.storyId == null) return true;
  if (activeStoryId == null) return false;
  return selection.storyId === activeStoryId;
}

/** 读取侧统一入口：不属于当前故事的选区一律读成「没有选区」。 */
export function scopedSelection<T extends Pick<SelectionContext, "storyId">>(
  selection: T | null | undefined,
  activeStoryId: number | null | undefined
): T | null {
  return selectionBelongsToStory(selection, activeStoryId)
    ? (selection ?? null)
    : null;
}
