/**
 * StoryListView -- Shows all stories for the user.
 * Displayed in the story tab before a story is selected.
 */
import {
  AlertTriangle,
  BookOpen,
  Cloud,
  FileUp,
  Film,
  Layers3,
  Loader2,
  Music2,
  Pencil,
  Plus,
  Ratio,
  Trash2,
  Check,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useStoryAgent } from '@/features/storyAgent/StoryAgentContext';
import { trpc } from '@/lib/trpc';

type ChatCutImportPreview = {
  fileName: string;
  xml: string;
  title: string;
  summary: {
    sequenceName: string;
    durationMs: number;
    fps: number;
    width: number;
    height: number;
    videoTrackCount: number;
    audioTrackCount: number;
    primaryClipCount: number;
    audioClipCount: number;
    mediaFileCount: number;
    mediaFiles: string[];
  };
};

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
    refreshStoryList,
  } = useStoryAgent();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importPreview, setImportPreview] =
    useState<ChatCutImportPreview | null>(null);
  const [editingStoryTitle, setEditingStoryTitle] = useState<{
    id: number;
    value: string;
  } | null>(null);
  const inspectXml = trpc.storyAgent.inspectChatCutXml.useMutation();
  const importXml = trpc.storyAgent.importChatCutXml.useMutation();
  const renameStory = trpc.storyAgent.storyRename.useMutation();

  const chooseXml = () => fileInputRef.current?.click();

  const inspectSelectedXml = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.xml')) {
      toast.error('请选择 ChatCut 导出的 XML 文件');
      return;
    }
    if (file.size > 2_000_000) {
      toast.error('XML 文件过大，请控制在 2MB 以内');
      return;
    }

    try {
      const xml = await file.text();
      const summary = await inspectXml.mutateAsync({ xml });
      setImportPreview({
        fileName: file.name,
        xml,
        title: summary.sequenceName,
        summary,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'XML 读取失败');
    }
  };

  const confirmImport = async () => {
    if (!importPreview || importXml.isPending) return;
    try {
      const result = await importXml.mutateAsync({
        xml: importPreview.xml,
        title: importPreview.title.trim() || importPreview.summary.sequenceName,
      });
      setImportPreview(null);
      await refreshStoryList();
      await loadStory(result.storyId);
      toast.success(
        `已导入 ${result.summary.primaryClipCount} 个镜头，素材清单等待重新关联`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'ChatCut XML 导入失败');
    }
  };

  const commitStoryTitle = async () => {
    if (!editingStoryTitle || renameStory.isPending) return;
    const title = editingStoryTitle.value.trim();
    if (!title) {
      toast.error('故事名称不能为空');
      return;
    }
    try {
      const result = await renameStory.mutateAsync({
        id: editingStoryTitle.id,
        title,
      });
      if (result.status !== 'ok') {
        toast.error(result.error);
        return;
      }
      setEditingStoryTitle(null);
      toast.success('故事名称已更新');
      const refreshed = await refreshStoryList();
      if (!refreshed) {
        toast.error('名称已更新，但列表刷新失败');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '故事改名失败');
    }
  };

  return (
    <div className="monitor-panel h-full flex flex-col">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xml,text/xml,application/xml"
        className="sr-only"
        aria-label="选择 ChatCut XML"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void inspectSelectedXml(file);
        }}
      />
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
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={chooseXml}
            disabled={inspectXml.isPending}
            className="flex h-6 w-6 items-center justify-center opacity-70 transition-opacity hover:opacity-100 disabled:cursor-wait disabled:opacity-40"
            aria-label="导入 ChatCut XML"
            title="导入 ChatCut XML"
          >
            {inspectXml.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <FileUp className="w-3 h-3" />
            )}
          </button>
          <button
            type="button"
            onClick={createNewStory}
            className="flex h-6 w-6 items-center justify-center opacity-70 hover:opacity-100 transition-opacity"
            aria-label="新建故事"
            title="新建故事"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
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
            <button
              type="button"
              onClick={chooseXml}
              disabled={inspectXml.isPending}
              className="mt-2 w-full flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition-colors hover:border-[var(--nayin-accent)] disabled:cursor-wait disabled:opacity-50"
              style={{ borderColor: 'var(--panel-border)' }}
              title="从 ChatCut 或 Premiere XML 建立可编辑故事"
            >
              {inspectXml.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileUp className="w-3.5 h-3.5" />
              )}
              导入 ChatCut XML
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
              if (event.target !== event.currentTarget) return;
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
                {editingStoryTitle?.id === story.id ? (
                  <div
                    className="flex items-center gap-1"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <input
                      autoFocus
                      value={editingStoryTitle.value}
                      maxLength={255}
                      onChange={(event) =>
                        setEditingStoryTitle({
                          id: story.id,
                          value: event.target.value,
                        })
                      }
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void commitStoryTitle();
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setEditingStoryTitle(null);
                        }
                      }}
                      aria-label={`修改「${story.title || '未命名故事'}」的故事名称`}
                      className="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-xs font-medium outline-none focus:border-[var(--nayin-accent)] focus:ring-2 focus:ring-[var(--nayin-glow)]"
                      style={{ borderColor: 'var(--panel-border)' }}
                    />
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void commitStoryTitle();
                      }}
                      disabled={renameStory.isPending}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--nayin-accent-bright)] transition-colors hover:bg-[var(--nayin-glow)] disabled:opacity-40"
                      aria-label="保存故事名称"
                      title="保存"
                    >
                      {renameStory.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Check className="h-3 w-3" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setEditingStoryTitle(null);
                      }}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted"
                      aria-label="取消修改故事名称"
                      title="取消"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <div className="flex min-w-0 items-center gap-1.5">
                    <h3 className="min-w-0 flex-1 truncate text-xs font-medium">
                      {story.title || '未命名故事'}
                    </h3>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setEditingStoryTitle({
                          id: story.id,
                          value: story.title || '',
                        });
                      }}
                      className="flex h-6 shrink-0 items-center justify-center gap-1 rounded px-1.5 text-[10px] text-muted-foreground/70 transition-colors hover:bg-[var(--nayin-glow)] hover:text-[var(--nayin-accent-bright)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]"
                      aria-label={`修改「${story.title || '未命名故事'}」的故事名称`}
                      title="修改故事名称"
                    >
                      <Pencil className="h-3 w-3" />
                      改名
                    </button>
                  </div>
                )}
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

      <Dialog
        open={Boolean(importPreview)}
        onOpenChange={(open) => {
          if (!open && !importXml.isPending) setImportPreview(null);
        }}
      >
        <DialogContent className="sm:max-w-xl" showCloseButton={!importXml.isPending}>
          {importPreview ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">导入 ChatCut 时间轴</DialogTitle>
                <DialogDescription className="text-xs">
                  {importPreview.fileName}
                </DialogDescription>
              </DialogHeader>

              <label className="grid gap-1.5 text-xs font-medium">
                故事名称
                <input
                  value={importPreview.title}
                  onChange={(event) =>
                    setImportPreview((current) =>
                      current ? { ...current, title: event.target.value } : current,
                    )
                  }
                  disabled={importXml.isPending}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm font-normal outline-none transition focus:border-[var(--nayin-accent)] focus:ring-2 focus:ring-[var(--nayin-glow)]"
                />
              </label>

              <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-y border-border/70 py-4 text-xs sm:grid-cols-3">
                <div>
                  <dt className="flex items-center gap-1 text-muted-foreground">
                    <Film className="h-3.5 w-3.5" /> 时长
                  </dt>
                  <dd className="mt-1 font-medium tabular-nums">
                    {(importPreview.summary.durationMs / 1000).toFixed(1)} 秒
                  </dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1 text-muted-foreground">
                    <Ratio className="h-3.5 w-3.5" /> 画布
                  </dt>
                  <dd className="mt-1 font-medium tabular-nums">
                    {importPreview.summary.width}×{importPreview.summary.height}
                  </dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1 text-muted-foreground">
                    <Layers3 className="h-3.5 w-3.5" /> 视频轨
                  </dt>
                  <dd className="mt-1 font-medium">
                    {importPreview.summary.videoTrackCount} 轨 ·{' '}
                    {importPreview.summary.primaryClipCount} 镜
                  </dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1 text-muted-foreground">
                    <Music2 className="h-3.5 w-3.5" /> 音频
                  </dt>
                  <dd className="mt-1 font-medium">
                    {importPreview.summary.audioTrackCount} 轨 ·{' '}
                    {importPreview.summary.audioClipCount} 段
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">帧率</dt>
                  <dd className="mt-1 font-medium tabular-nums">
                    {importPreview.summary.fps} fps
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">素材文件</dt>
                  <dd className="mt-1 font-medium">
                    {importPreview.summary.mediaFileCount} 个
                  </dd>
                </div>
              </dl>

              <div className="flex gap-2 rounded-md border border-amber-500/25 bg-amber-500/8 px-3 py-2.5 text-xs leading-relaxed text-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p>
                  时间、主轨顺序、裁剪、缩放、变速、多轨和音频清单会保留。XML
                  只记录文件名，导入后请在素材仓库重新关联原图片与视频。
                </p>
              </div>

              <div className="max-h-24 overflow-y-auto text-[11px] leading-relaxed text-muted-foreground custom-scrollbar">
                {importPreview.summary.mediaFiles.slice(0, 8).join(' · ')}
                {importPreview.summary.mediaFiles.length > 8
                  ? ` · 另 ${importPreview.summary.mediaFiles.length - 8} 个`
                  : ''}
              </div>

              <DialogFooter>
                <button
                  type="button"
                  onClick={() => setImportPreview(null)}
                  disabled={importXml.isPending}
                  className="h-9 rounded-md border border-border px-3 text-xs font-medium transition hover:bg-muted disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void confirmImport()}
                  disabled={importXml.isPending || !importPreview.title.trim()}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    background: 'var(--nayin-accent)',
                    color: 'var(--background)',
                  }}
                >
                  {importXml.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileUp className="h-3.5 w-3.5" />
                  )}
                  导入并打开
                </button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
