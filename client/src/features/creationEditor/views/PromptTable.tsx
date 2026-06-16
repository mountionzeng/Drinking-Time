import { useMemo, useState } from 'react';
import { Filter, ListFilter } from 'lucide-react';
import type { CreationEditorShot } from '../CreationEditorContext';
import { buildPromptTable } from '../promptTable/buildPromptTable';
import {
  filterPromptRowsBySource,
  getPromptTableColumns,
  sortPromptRows,
  sourceFilterOptions,
  type PromptSortMode,
  type PromptSourceFilter,
  type PromptTableColumn,
} from '../promptTable/sort';
import type { PromptRow, PromptSourceSystem } from '../promptTable/types';

type PromptTableProps = {
  shot: CreationEditorShot | null;
  rows?: PromptRow[];
};

const SORT_LABELS: Record<PromptSortMode, string> = {
  weight: '权重',
  contentLength: '内容量',
};

const SOURCE_LABELS: Record<PromptSourceFilter, string> = {
  all: '全部',
  chat: '聊天',
  intent: '意图',
  'art-repo': 'art库',
  inheritance: '继承',
  manual: '手改',
};

const CATEGORY_LABELS: Record<PromptRow['category'], string> = {
  content: '内容型',
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
    case 'weight':
      return '权重';
    case 'source':
      return '出处';
    case 'inheritance':
      return '状态';
  }
}

function renderCell(row: PromptRow, column: PromptTableColumn) {
  switch (column) {
    case 'dimension':
      return <span className="font-medium">{row.label}</span>;
    case 'category':
      return <span className="text-xs text-muted-foreground">{CATEGORY_LABELS[row.category]}</span>;
    case 'value':
      return <span className="block min-w-[220px] whitespace-pre-wrap leading-6">{row.value}</span>;
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

export default function PromptTable({ shot, rows }: PromptTableProps) {
  const [sortMode, setSortMode] = useState<PromptSortMode>('weight');
  const [sourceFilter, setSourceFilter] = useState<PromptSourceFilter>('all');
  const baseRows = useMemo(() => rows ?? (shot ? buildPromptTable(shot) : []), [rows, shot]);
  const sourceOptions = useMemo(() => sourceFilterOptions(baseRows), [baseRows]);
  const displayedRows = useMemo(
    () => sortPromptRows(filterPromptRowsBySource(baseRows, sourceFilter), sortMode),
    [baseRows, sortMode, sourceFilter],
  );
  const columns = useMemo(() => getPromptTableColumns(displayedRows), [displayedRows]);

  if (!shot) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        选择一个镜头后查看提示词表
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="prompt-table">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ListFilter className="h-4 w-4" />
          <span>{displayedRows.length} 条提示词</span>
        </div>
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
                    {renderCell(row, column)}
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
