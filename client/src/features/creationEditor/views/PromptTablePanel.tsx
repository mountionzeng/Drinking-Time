import { ListFilter } from 'lucide-react';
import { useCreationEditor } from '../CreationEditorContext';
import PromptTable from './PromptTable';

function shotLabel(shotNo: number | null) {
  return shotNo == null ? '等待镜头' : `SH${String(shotNo).padStart(2, '0')}`;
}

export default function PromptTablePanel() {
  const {
    shots,
    selectedShotNo,
    selectedShot,
    isLoading,
    error,
    isSaving,
    rerenderingShotNo,
    rerenderError,
    updatePromptOverride,
    rerenderShot,
  } = useCreationEditor();

  return (
    <aside
      className="monitor-panel flex h-full min-h-0 flex-col overflow-hidden"
      aria-label="镜头设计表"
      data-testid="analysis-prompt-table-panel"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <ListFilter className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">镜头设计表</h2>
        </div>
        <span className="text-xs text-muted-foreground">{shotLabel(selectedShotNo)}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-4">
        {error ? (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error.message || '加载镜头设计表失败'}
          </div>
        ) : null}
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            正在加载镜头设计表…
          </div>
        ) : shots.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            生成故事版后，镜头设计表会出现在这里。
          </div>
        ) : (
          <PromptTable
            shot={selectedShot}
            shots={shots}
            disabled={isSaving}
            rerendering={selectedShotNo != null && rerenderingShotNo === selectedShotNo}
            error={rerenderError}
            onOverrideChange={updatePromptOverride}
            onRerenderShot={rerenderShot}
          />
        )}
      </div>
    </aside>
  );
}
