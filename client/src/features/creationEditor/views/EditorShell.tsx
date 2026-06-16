import { Film, ListFilter, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useCreationEditor,
  type CreationEditorError,
  type CreationEditorShot,
} from '../CreationEditorContext';
import { useState } from 'react';
import AnimaticPlayer from './AnimaticPlayer';
import PromptTable from './PromptTable';
import Timeline from './Timeline';

export type EditorShellViewProps = {
  title: string;
  logline?: string | null;
  shots: CreationEditorShot[];
  selectedShotNo: number | null;
  selectedShot: CreationEditorShot | null;
  isLoading?: boolean;
  error?: CreationEditorError | null;
  isPlaying?: boolean;
  durationsByShotNo?: Record<number, number>;
  onSelectShot: (shotNo: number) => void;
  onPlayingChange?: (isPlaying: boolean) => void;
  onDurationChange?: (shotNo: number, durationMs: number) => void;
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
  isPlaying = false,
  durationsByShotNo = {},
  onSelectShot,
  onPlayingChange = () => undefined,
  onDurationChange = () => undefined,
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
              <AnimaticPlayer
                shots={shots}
                selectedShotNo={selectedShotNo}
                durationsByShotNo={durationsByShotNo}
                onShotEnter={onSelectShot}
                isPlaying={isPlaying}
                onPlayingChange={onPlayingChange}
              />
              <Timeline
                shots={shots}
                selectedShotNo={selectedShotNo}
                durationsByShotNo={durationsByShotNo}
                onSelectShot={onSelectShot}
                onDurationChange={onDurationChange}
              />
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

            <div className="min-h-0 flex-1 overflow-hidden p-4">
              <PromptTable shot={selectedShot} shots={shots} />
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
  const [isPlaying, setIsPlaying] = useState(false);
  const [durationsByShotNo, setDurationsByShotNo] = useState<Record<number, number>>({});

  return (
    <EditorShellView
      title={activeStory?.title || 'Creation Studio'}
      logline={activeStory?.logline}
      shots={shots}
      selectedShotNo={selectedShotNo}
      selectedShot={selectedShot}
      isLoading={isLoading}
      error={error}
      isPlaying={isPlaying}
      durationsByShotNo={durationsByShotNo}
      onSelectShot={setSelectedShotNo}
      onPlayingChange={setIsPlaying}
      onDurationChange={(shotNo, durationMs) => {
        setDurationsByShotNo((current) => ({ ...current, [shotNo]: durationMs }));
      }}
      onRefresh={refetch}
    />
  );
}
