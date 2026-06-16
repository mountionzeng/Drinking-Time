import { Film, ListFilter, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useCreationEditor,
  type CreationEditorError,
  type CreationEditorShot,
} from '../CreationEditorContext';

export type EditorShellViewProps = {
  title: string;
  logline?: string | null;
  shots: CreationEditorShot[];
  selectedShotNo: number | null;
  selectedShot: CreationEditorShot | null;
  isLoading?: boolean;
  error?: CreationEditorError | null;
  onSelectShot: (shotNo: number) => void;
  onRefresh?: () => void;
};

function shotLabel(shot: CreationEditorShot) {
  return shot.shotKey || `SH${String(shot.shotNo).padStart(2, '0')}`;
}

export function EditorShellView({
  title,
  logline,
  shots,
  selectedShotNo,
  selectedShot,
  isLoading = false,
  error = null,
  onSelectShot,
  onRefresh,
}: EditorShellViewProps) {
  return (
    <main className="min-h-screen bg-background text-foreground" data-testid="creation-editor-shell">
      <div className="mx-auto flex h-screen max-w-[1680px] flex-col gap-3 px-4 py-3">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Creation Studio
            </div>
            <h1 className="truncate text-2xl font-semibold leading-tight">{title}</h1>
            {logline ? (
              <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{logline}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{shots.length} 镜</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRefresh}
              disabled={!onRefresh || isLoading}
              aria-label="刷新故事"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error.message || '加载制作台失败'}
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.8fr)]">
          <section
            className="monitor-panel flex min-h-0 flex-col overflow-hidden"
            aria-label="动态分镜播放区"
            data-testid="animatic-panel"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
              <div className="flex items-center gap-2">
                <Film className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">动态分镜</h2>
              </div>
              <span className="text-xs text-muted-foreground">
                {selectedShot ? shotLabel(selectedShot) : '未选镜头'}
              </span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
              <div className="relative flex min-h-[320px] flex-1 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-muted/40">
                {selectedShot?.imageUrl ? (
                  <img
                    src={selectedShot.imageUrl}
                    alt={shotLabel(selectedShot)}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="max-w-md px-6 text-center">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                      <Film className="h-5 w-5 text-primary" />
                    </div>
                    <p className="text-sm font-medium">等待当前镜画面</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      U2 会在这里接入顺序连播、字幕和时长控制。
                    </p>
                  </div>
                )}
                {selectedShot?.dialogue ? (
                  <div className="absolute inset-x-6 bottom-5 rounded-md bg-background/88 px-4 py-3 text-center text-sm shadow-sm backdrop-blur">
                    {selectedShot.dialogue}
                  </div>
                ) : null}
              </div>

              <div className="flex min-h-[72px] gap-2 overflow-x-auto rounded-md border border-border/70 bg-background/70 p-2">
                {shots.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    还没有可剪辑的镜头
                  </div>
                ) : (
                  shots.map((shot) => (
                    <button
                      key={shot.shotKey}
                      type="button"
                      onClick={() => onSelectShot(shot.shotNo)}
                      className={`flex min-w-[92px] flex-col justify-between rounded-md border px-3 py-2 text-left transition ${
                        selectedShotNo === shot.shotNo
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border bg-card hover:border-primary/40'
                      }`}
                    >
                      <span className="text-xs font-semibold">{shotLabel(shot)}</span>
                      <span className="line-clamp-1 text-xs text-muted-foreground">
                        {shot.beat || shot.subject || shot.mood || '镜头'}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </section>

          <aside
            className="monitor-panel flex min-h-0 flex-col overflow-hidden"
            aria-label="提示词表"
            data-testid="prompt-table-panel"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
              <div className="flex items-center gap-2">
                <ListFilter className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">提示词表</h2>
              </div>
              <span className="text-xs text-muted-foreground">
                {selectedShot ? shotLabel(selectedShot) : '等待镜头'}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              {selectedShot ? (
                <div className="space-y-3">
                  <div className="rounded-md border border-border/70 bg-background/70 p-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      当前镜
                    </div>
                    <div className="mt-2 text-base font-semibold">{shotLabel(selectedShot)}</div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {selectedShot.beat || selectedShot.sourceCardContent || selectedShot.subject || '这个镜头还没有文字描述。'}
                    </p>
                  </div>
                  <div className="rounded-md border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
                    U3–U5 会在这里展开内容维度、美术维度、出处、权重、继承与筛选。
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  选择一个镜头后查看提示词表
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

export default function EditorShell() {
  const {
    activeStory,
    shots,
    selectedShotNo,
    selectedShot,
    setSelectedShotNo,
    isLoading,
    error,
    refetch,
  } = useCreationEditor();

  return (
    <EditorShellView
      title={activeStory?.title || 'Creation Studio'}
      logline={activeStory?.logline}
      shots={shots}
      selectedShotNo={selectedShotNo}
      selectedShot={selectedShot}
      isLoading={isLoading}
      error={error}
      onSelectShot={setSelectedShotNo}
      onRefresh={refetch}
    />
  );
}
