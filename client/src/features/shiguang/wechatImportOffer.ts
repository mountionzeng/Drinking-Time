type Page = {
  stories: Array<{ importedStoryId: number | null }>;
  nextCursor: number | null;
};

/** Read metadata only; a page containing only migrated/deleted stories is not the end. */
export async function hasPendingWechatStories(
  load: (cursor: number) => Promise<Page>,
  current = () => true
) {
  let cursor = 0;
  while (current()) {
    const page = await load(cursor);
    if (!current()) return false;
    if (page.stories.some(story => story.importedStoryId === null)) return true;
    if (page.nextCursor === null) return false;
    if (
      !Number.isSafeInteger(page.nextCursor) ||
      page.nextCursor <= cursor ||
      page.nextCursor > 10000
    )
      throw new Error("invalid_wechat_catalog_cursor");
    cursor = page.nextCursor;
  }
  return false;
}

export const wechatPromptStorageKey = (userId: number) =>
  `wechat-import-prompt:v1:${userId}`;
