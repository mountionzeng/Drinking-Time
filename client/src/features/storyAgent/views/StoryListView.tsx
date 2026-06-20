/**
 * StoryListView -- Shows all stories for the user.
 * Displayed in the story tab before a story is selected.
 */
import { Plus, Trash2, Loader2, BookOpen, Cloud } from 'lucide-react';
import { useStoryAgent } from '@/features/storyAgent/StoryAgentContext';

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export default function StoryListView() {
  const {
    storyList,
    isLoadingStories,
    loadStory,
    createNewStory,
    deleteStory,
  } = useStoryAgent();

  return (
    <div className="monitor-panel h-full flex flex-col">
      <div className="monitor-panel-header">
        <div className="status-dot" />
        <span>故事列表</span>
        <span
          className="ml-2 hidden items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground sm:inline-flex"
          style={{
            background: 'var(--nayin-glow)',
            color: 'var(--nayin-accent-dim)',
          }}
        >
          <Cloud className="h-2.5 w-2.5" />
          当前账号 · 云端故事库
        </span>
        <button
          type="button"
          onClick={createNewStory}
          className="ml-auto flex items-center gap-1 text-[10px] opacity-70 hover:opacity-100 transition-opacity"
          title="新建故事"
        >
          <Plus className="w-3 h-3" />
          新建
        </button>
      </div>

      <div className="monitor-panel-body flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
        {isLoadingStories && storyList.length === 0 && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            <span className="text-xs">加载中...</span>
          </div>
        )}

        {!isLoadingStories && storyList.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
            <BookOpen className="w-8 h-8 opacity-30" />
            <p className="text-xs">还没有故事</p>
            <button
              type="button"
              onClick={createNewStory}
              className="text-xs px-3 py-1.5 rounded-lg transition-colors"
              style={{
                background: 'var(--nayin-accent)',
                color: 'var(--background)',
              }}
            >
              开始第一个故事
            </button>
          </div>
        )}

        {/* Option A：老用户进门先看「继续 vs 开新」的整屏问句，而非被默默带进最近一篇。
            醒目问句 + 整宽「开始新故事」按钮 + 下方提示「点任意一篇接着聊」。 */}
        {!isLoadingStories && storyList.length > 0 && (
          <div
            className="pb-3 mb-1 border-b"
            style={{ borderColor: 'var(--panel-border)' }}
          >
            <p className="text-sm font-medium leading-snug mb-2">
              继续上次没聊完的，还是开个新的？
            </p>
            <button
              type="button"
              onClick={createNewStory}
              className="w-full flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg transition-colors"
              style={{
                background: 'var(--nayin-accent)',
                color: 'var(--background)',
              }}
              title="从头说一件新的小事"
            >
              <Plus className="w-3.5 h-3.5" />
              开始新故事
            </button>
            <p className="text-[10px] text-muted-foreground leading-snug mt-2">
              或点下面任意一篇，接着上次聊。
            </p>
          </div>
        )}

        {storyList.map((story) => (
          <div
            key={story.id}
            role="button"
            tabIndex={0}
            onClick={() => loadStory(story.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                loadStory(story.id);
              }
            }}
            className="w-full text-left rounded-lg border p-3 transition-colors hover:border-[var(--nayin-accent)] group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]"
            style={{
              background: 'var(--card)',
              borderColor: 'var(--panel-border)',
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <h3 className="text-xs font-medium truncate">
                  {story.title || '未命名故事'}
                </h3>
                {story.logline && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                    {story.logline}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground font-mono">
                  <span>云端 #{story.id}</span>
                  {(story.cardCount ?? 0) > 0 && (
                    <span>{story.cardCount} 卡片</span>
                  )}
                  {(story.shotCount ?? 0) > 0 && (
                    <span>{story.shotCount} 镜头</span>
                  )}
                  {story.updatedAt && (
                    <span>{formatDate(story.updatedAt)}</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm('确定删除这个故事吗？')) {
                    deleteStory(story.id);
                  }
                }}
                className="opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity p-1"
                title="删除"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
