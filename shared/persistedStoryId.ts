/**
 * 只有服务端已落库的故事（正整数 id）才能用于按故事查询。
 * 新故事在首存前是 -1，空选择是 null/0；这些值发给 storyId 校验严格的
 * 接口会直接 400（timelineMedia.narrationCandidates / audioAssetLibrary 等）。
 */
export function isPersistedStoryId(
  storyId: number | null | undefined
): storyId is number {
  return typeof storyId === "number" && Number.isSafeInteger(storyId) && storyId > 0;
}
