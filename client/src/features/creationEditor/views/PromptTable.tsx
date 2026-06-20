import { useMemo, useState } from 'react';
import { CheckCircle2, Eye, Filter, ListFilter, Video } from 'lucide-react';
import type { CreationEditorShot } from '../CreationEditorContext';
import { buildPromptTable } from '../promptTable/buildPromptTable';
import { compilePromptRecipe, promptRunUsesDimension } from '../promptTable/promptRecipe';
import { compileVideoShotRecipe } from '../promptTable/videoRecipe';
import {
  filterPromptRowsBySource,
  getPromptTableColumns,
  sortPromptRows,
  sourceFilterOptions,
  type PromptSortMode,
  type PromptSourceFilter,
  type PromptTableColumn,
} from '../promptTable/sort';
import type { PromptOverride, PromptRow, PromptSourceSystem } from '../promptTable/types';
import PromptCellEditor from './PromptCellEditor';

type PromptTableProps = {
  shot: CreationEditorShot | null;
  shots?: CreationEditorShot[];
  rows?: PromptRow[];
  disabled?: boolean;
  rerendering?: boolean;
  error?: string | null;
  onOverrideChange?: (
    shotNo: number,
    dimension: string,
    override: PromptOverride,
  ) => Promise<void> | void;
  onRerenderShot?: (
    shotNo: number,
    rows: PromptRow[],
  ) => Promise<void> | void;
};

const SORT_LABELS: Record<PromptSortMode, string> = {
  weight: '权重',
  contentLength: '内容量',
};

const SOURCE_LABELS: Record<PromptSourceFilter, string> = {
  all: '全部',
  chat: '聊天',
  intent: '意图',
  director: '导演',
  'art-repo': 'art库',
  inheritance: '继承',
  manual: '手改',
};

const CATEGORY_LABELS: Record<PromptRow['category'], string> = {
  content: '内容型',
  narrative: '叙事型',
  motion: '视频型',
  style: '风格型',
};

const INHERITANCE_LABELS: Record<PromptRow['inheritance'], string> = {
  own: '本镜',
  inherited: '继承',
  overridden: '覆盖',
};

const SOURCE_BADGE_CLASS: Record<PromptSourceSystem, string> = {
  chat: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
  intent: 'bg-sky-500/10 text-sky-700 border-sky-500/20',
  director: 'bg-orange-500/10 text-orange-700 border-orange-500/20',
  'art-repo': 'bg-violet-500/10 text-violet-700 border-violet-500/20',
  inheritance: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
  manual: 'bg-rose-500/10 text-rose-700 border-rose-500/20',
};

function columnLabel(column: PromptTableColumn) {
  switch (column) {
    case 'dimension':
      return '维度';
    case 'category':
      return '分类';
    case 'value':
      return '值';
    case 'usage':
      return '出图状态';
    case 'weight':
      return '权重';
    case 'source':
      return '出处';
    case 'inheritance':
      return '状态';
  }
}

function usageLabel(shot: CreationEditorShot, row: PromptRow) {
  if (!shot.promptRun) return shot.imagePrompt ? '当前画面' : '待生成';
  if (!promptRunUsesDimension(shot.promptRun, row.dimension)) return '未使用';
  if (row.inheritance === 'overridden') return '手改已用';
  if (row.inheritance === 'inherited') return '继承已用';
  return '已使用';
}

function usageClass(label: string) {
  if (label === '待生成') return 'border-border bg-muted text-muted-foreground';
  if (label === '当前画面') return 'border-amber-500/20 bg-amber-500/10 text-amber-700';
  if (label === '未使用') return 'border-border bg-background text-muted-foreground';
  if (label === '手改已用') return 'border-rose-500/20 bg-rose-500/10 text-rose-700';
  if (label === '继承已用') return 'border-amber-500/20 bg-amber-500/10 text-amber-700';
  return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700';
}

function renderCell(row: PromptRow, column: PromptTableColumn, shot: CreationEditorShot) {
  switch (column) {
    case 'dimension':
      return <span className="font-medium">{row.label}</span>;
    case 'category':
      return <span className="text-xs text-muted-foreground">{CATEGORY_LABELS[row.category]}</span>;
    case 'value':
      return <span className="block min-w-[220px] whitespace-pre-wrap leading-6">{row.value}</span>;
    case 'usage': {
      const label = usageLabel(shot, row);
      return (
        <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${usageClass(label)}`}>
          {label}
        </span>
      );
    }
    case 'weight':
      return <span className="tabular-nums">{Math.round(row.weight * 100)}%</span>;
    case 'source':
      return (
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${SOURCE_BADGE_CLASS[row.source.system]}`}>
          {row.source.label}
        </span>
      );
    case 'inheritance':
      return (
        <span
          className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${
            row.inheritance === 'overridden'
              ? 'border-rose-500/20 bg-rose-500/10 text-rose-700'
              : row.inheritance === 'inherited'
                ? 'border-amber-500/20 bg-amber-500/10 text-amber-700'
                : 'border-border bg-muted text-muted-foreground'
          }`}
        >
          {INHERITANCE_LABELS[row.inheritance]}
        </span>
      );
  }
}

function rowWithOverride(row: PromptRow, override: PromptOverride): PromptRow {
  const value = override.value?.trim() || row.value;
  const weight = typeof override.weight === 'number' && Number.isFinite(override.weight)
    ? override.weight
    : row.weight;
  return {
    ...row,
    value,
    weight,
    source: {
      system: 'manual',
      label: '手改',
      sourceCardContent: row.source.sourceCardContent,
    },
    inheritance: 'overridden',
    contentLength: Array.from(value).length,
  };
}

export default function PromptTable({
  shot,
  shots = [],
  rows,
  disabled = false,
  rerendering = false,
  error = null,
  onOverrideChange,
  onRerenderShot,
}: PromptTableProps) {
  const [sortMode, setSortMode] = useState<PromptSortMode>('weight');
  const [sourceFilter, setSourceFilter] = useState<PromptSourceFilter>('all');
  const previousShots = useMemo(
    () => (shot ? shots.filter((item) => item.shotNo < shot.shotNo) : []),
    [shot, shots],
  );
  const baseRows = useMemo(
    () => rows ?? (shot ? buildPromptTable(shot, { previousShots }) : []),
    [previousShots, rows, shot],
  );
  const sourceOptions = useMemo(() => sourceFilterOptions(baseRows), [baseRows]);
  const displayedRows = useMemo(
    () => sortPromptRows(filterPromptRowsBySource(baseRows, sourceFilter), sortMode),
    [baseRows, sortMode, sourceFilter],
  );
  const dimensionLabels = useMemo(
    () => new Map(baseRows.map((row) => [row.dimension, row.label])),
    [baseRows],
  );
  const columns = useMemo(() => getPromptTableColumns(displayedRows), [displayedRows]);
  const compiledPrompt = useMemo(
    () => (shot ? compilePromptRecipe({ shot, rows: baseRows }) : null),
    [baseRows, shot],
  );
  const videoRecipe = useMemo(
    () => (shot ? compileVideoShotRecipe({ shot, rows: baseRows }) : null),
    [baseRows, shot],
  );
  const [showFinalPrompt, setShowFinalPrompt] = useState(false);
  const [showVideoRecipe, setShowVideoRecipe] = useState(false);
  const promptStateLabel = shot?.promptRun
    ? '已用于出图'
    : shot?.imagePrompt
      ? '当前画面提示词'
      : '生成时形成';
  const promptStateClass = shot?.promptRun
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700'
    : shot?.imagePrompt
      ? 'border-amber-500/20 bg-amber-500/10 text-amber-700'
      : 'border-border bg-muted';
  const videoStateReady = Boolean(videoRecipe && videoRecipe.missing.length === 0);
  const videoStateLabel = videoStateReady
    ? '视频输入就绪'
    : videoRecipe?.missing.length
      ? `缺 ${videoRecipe.missing.join(' / ')}`
      : '等待镜头';
  const videoStateClass = videoStateReady
    ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700'
    : 'border-amber-500/20 bg-amber-500/10 text-amber-700';

  if (!shot) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        选择一个镜头后查看镜头设计表
      </div>
    );
  }

  const applyOverride = async (row: PromptRow, override: PromptOverride) => {
    await onOverrideChange?.(shot.shotNo, row.dimension, override);
  };

  const rerenderWithOverride = async (row: PromptRow, override: PromptOverride) => {
    await onOverrideChange?.(shot.shotNo, row.dimension, override);
    const nextRows = baseRows.map((candidate) =>
      candidate.id === row.id ? rowWithOverride(candidate, override) : candidate,
    );
    await onRerenderShot?.(shot.shotNo, nextRows);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="prompt-table">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ListFilter className="h-4 w-4" />
          <span>{displayedRows.length} 条镜头设计</span>
          <span className={`rounded-full border px-2 py-0.5 ${promptStateClass}`}>
            {promptStateLabel}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${videoStateClass}`}>
            {videoStateReady ? <CheckCircle2 className="h-3 w-3" /> : <Video className="h-3 w-3" />}
            {videoStateLabel}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowFinalPrompt((value) => !value)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground transition hover:text-foreground"
          >
            <Eye className="h-3.5 w-3.5" />
            查看最终生成提示词
          </button>
          <button
            type="button"
            onClick={() => setShowVideoRecipe((value) => !value)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground transition hover:text-foreground"
          >
            <Video className="h-3.5 w-3.5" />
            查看本镜视频包
          </button>
          <div className="flex rounded-md border border-border bg-background p-0.5">
            {(Object.keys(SORT_LABELS) as PromptSortMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSortMode(mode)}
                className={`rounded px-2.5 py-1 text-xs transition ${
                  sortMode === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {SORT_LABELS[mode]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        {sourceOptions.map(({ source, count }) => (
          <button
            key={source}
            type="button"
            onClick={() => setSourceFilter(source)}
            className={`rounded-full border px-2.5 py-1 text-xs transition ${
              sourceFilter === source
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border bg-background text-muted-foreground hover:text-foreground'
            }`}
          >
            {SOURCE_LABELS[source]} · {count}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {showFinalPrompt ? (
        <div className="rounded-md border border-border bg-background p-3 text-xs">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-semibold text-foreground">
              {shot.promptRun
                ? '本镜真实出图提示词'
                : shot.imagePrompt
                  ? '本镜当前画面提示词'
                  : '本镜下次出图提示词预览'}
            </span>
            {shot.promptRun ? (
              <span className="text-muted-foreground">
                {new Date(shot.promptRun.generatedAt).toLocaleString()}
              </span>
            ) : null}
          </div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-2 leading-5 text-muted-foreground">
            {shot.promptRun?.finalPrompt || shot.imagePrompt || compiledPrompt?.finalPrompt || '暂无提示词'}
          </pre>
          {shot.promptRun?.references?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {shot.promptRun.references.map((reference, index) => (
                <span
                  key={`${reference.kind}-${index}`}
                  className="rounded-full border border-border bg-muted px-2 py-0.5 text-muted-foreground"
                  title={reference.url}
                >
                  {reference.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {showVideoRecipe && videoRecipe ? (
        <div className="rounded-md border border-border bg-background p-3 text-xs" data-testid="video-recipe-panel">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-foreground">本镜图生视频输入包</span>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${videoStateClass}`}>
              {videoStateReady ? <CheckCircle2 className="h-3 w-3" /> : <Video className="h-3 w-3" />}
              {videoStateLabel}
            </span>
          </div>
          <div className="grid gap-2 md:grid-cols-[140px_1fr]">
            <div className="overflow-hidden rounded-md border border-border/70 bg-muted/40">
              {videoRecipe.sourceImageUrl ? (
                <img
                  src={videoRecipe.sourceImageUrl}
                  alt={`${shot.shotKey || `SH${String(shot.shotNo).padStart(2, '0')}`} 首帧图`}
                  className="aspect-video h-full w-full object-cover"
                />
              ) : (
                <div className="flex aspect-video items-center justify-center px-3 text-center text-muted-foreground">
                  缺首帧图
                </div>
              )}
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-2 leading-5 text-muted-foreground">
              {videoRecipe.finalPrompt}
            </pre>
          </div>
          {videoRecipe.usedDimensions.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {videoRecipe.usedDimensions.map((dimension) => (
                <span key={dimension} className="rounded-full border border-border bg-muted px-2 py-0.5 text-muted-foreground">
                  {dimensionLabels.get(dimension) ?? dimension}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-muted/90 backdrop-blur">
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground"
                >
                  {columnLabel(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayedRows.map((row) => (
              <tr
                key={row.id}
                className={`border-b border-border/70 last:border-0 ${
                  row.inheritance === 'overridden'
                    ? 'bg-rose-500/5'
                    : row.inheritance === 'inherited'
                      ? 'bg-amber-500/5'
                      : ''
                }`}
              >
                {columns.map((column) => (
                  <td key={column} className="align-top px-3 py-2">
                    {column === 'value' ? (
                      <PromptCellEditor
                        row={row}
                        disabled={disabled}
                        rerendering={rerendering}
                        onApply={(override) => applyOverride(row, override)}
                        onRerender={(override) => rerenderWithOverride(row, override)}
                      />
                    ) : (
                      renderCell(row, column, shot)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
