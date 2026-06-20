import { Film } from 'lucide-react';
import { useState } from 'react';
import { useCreationEditor } from '../CreationEditorContext';
import AnimaticPlayer from './AnimaticPlayer';
import Timeline from './Timeline';

function shotLabel(shotNo: number | null) {
  return shotNo == null ? '未选镜头' : `SH${String(shotNo).padStart(2, '0')}`;
}

export default function AnimaticPanel() {
  const {
    shots,
    selectedShotNo,
    setSelectedShotNo,
    isLoading,
    error,
    updateShotDuration,
    promoteFrameCrop,
    promotingFrameCropShotNo,
    generateShotVideo,
    generatingVideoShotNo,
  } = useCreationEditor();
  const [isPlaying, setIsPlaying] = useState(false);
  const [durationsByShotNo, setDurationsByShotNo] = useState<Record<number, number>>({});

  return (
    <section
      className="monitor-panel flex h-full min-h-0 flex-col overflow-hidden"
      aria-label="动态分镜"
      data-testid="analysis-animatic-panel"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <Film className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">动态分镜</h2>
        </div>
        <span className="text-xs text-muted-foreground">{shotLabel(selectedShotNo)}</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error.message || '加载动态分镜失败'}
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            正在加载动态分镜…
          </div>
        ) : shots.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            生成故事版后，动态分镜会出现在这里。
          </div>
        ) : (
          <>
            <AnimaticPlayer
              shots={shots}
              selectedShotNo={selectedShotNo}
              durationsByShotNo={durationsByShotNo}
              onShotEnter={setSelectedShotNo}
              isPlaying={isPlaying}
              onPlayingChange={setIsPlaying}
              onPromoteFrameCrop={promoteFrameCrop}
              promotingFrameCropShotNo={promotingFrameCropShotNo}
              onGenerateShotVideo={generateShotVideo}
              generatingVideoShotNo={generatingVideoShotNo}
            />
            <Timeline
              shots={shots}
              selectedShotNo={selectedShotNo}
              durationsByShotNo={durationsByShotNo}
              onSelectShot={setSelectedShotNo}
              onDurationChange={(shotNo, durationMs) => {
                setDurationsByShotNo((current) => ({ ...current, [shotNo]: durationMs }));
                void updateShotDuration(shotNo, durationMs);
              }}
            />
          </>
        )}
      </div>
    </section>
  );
}
