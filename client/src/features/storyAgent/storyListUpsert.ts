import type { StoryListItem } from "./spine/storySpine";

/**
 * 新故事首次保存拿到真 id 后，把它补进本地 storyList（已有同 id 时只补空标题），
 * 避免故事列表 / 切换器里看不到刚建的故事、或标题回落成「故事 #id」。
 */
export function upsertCreatedStoryListItem(
  items: StoryListItem[],
  created: { id: number; title?: string | null; logline?: string | null; summary?: string | null; savedAt?: Date }
): StoryListItem[] {
  if (!Number.isSafeInteger(created.id) || created.id <= 0) return items;
  const title = created.title?.trim() || "未命名";
  const existingIndex = items.findIndex(item => item.id === created.id);
  if (existingIndex >= 0) {
    const existing = items[existingIndex];
    if (existing.title?.trim()) return items;
    const next = items.slice();
    next[existingIndex] = { ...existing, title };
    return next;
  }
  const savedAt = created.savedAt ?? new Date();
  return [
    {
      id: created.id,
      title,
      logline: created.logline ?? null,
      summary: created.summary ?? null,
      createdAt: savedAt,
      updatedAt: savedAt,
    },
    ...items,
  ];
}
