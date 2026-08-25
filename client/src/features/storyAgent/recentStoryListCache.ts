/**
 * 冷刷新时，CreationEditorProvider 的 `storyList.useQuery()` 和 StoryAgent
 * 入口 hydrate 的 `refreshStoryList()` 会各自请求同一份 storyList；默认
 * QueryClient 的 staleTime 是 0，谁后请求谁就会把对方刚取回的数据当成
 * stale 再打一次网络。这个窗口只给「自动打开最近故事」这一条冷启动路径一个
 * 很短的复用余地，用户主动点的刷新/重命名后刷新（StoryListView.tsx）不传
 * 这个选项，继续强制真实网络请求。
 */
export const RECENT_STORY_LIST_CACHE_WINDOW_MS = 5_000;

export function coldEntryStoryListFetchOptions(): { staleTime: number } {
  return { staleTime: RECENT_STORY_LIST_CACHE_WINDOW_MS };
}

/**
 * 同样的问题发生在 storyGet 上：StoryAgent 的 `loadStory()` 用
 * `staleTime: 0` 强制真实取回最新 Story（跨端同步边界，不能动），写完
 * activeStoryId 之后 CreationEditorContext 的同 key `storyGet.useQuery()`
 * 才挂载/启用——不给它一个窗口的话，它会把刚取回的数据当成 stale 立刻再发
 * 一次请求。窄窗口只影响这个 observer 自己要不要在挂载时自动重新请求，不
 * 影响 invalidate()/refetch() 之类的显式刷新——那些始终会真正打网络。
 */
export const STORY_GET_MOUNT_STALE_WINDOW_MS = 5_000;
