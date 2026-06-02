/**
 * ShotTable — Shot Production Prompt Matrix
 * Matrix view: one row per shot, one column per prompt dimension.
 */
import { useMemo, useState } from 'react';
import { Copy, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useNayin } from '@/features/nayin/NayinContext';
import type { NayinElement } from '@/features/nayin/nayin';
import { STATUS_CONFIG } from '@/features/analysis/config/statusConfig';
import type { Priority, ShotStatus } from '@/features/analysis/types';
import ShotStageIllustration from './ShotStageIllustration';
import type { BackendShot } from '@/features/analysis/types';
import type { StoryShot } from '@/features/storyAgent/types';
import type { PromptFragment, FragmentTag } from '@/features/storyAgent/promptPool';
import { groupByTag } from '@/features/storyAgent/promptPool';
import { GapReminder } from '@/features/storyAgent/views/PromptReminders';

type EditableShotField = 'subject' | 'action' | 'dialogue';

function EditableLine({
  label,
  value,
  placeholder,
  onCommit,
  selectionSource,
}: {
  label: string;
  value: string;
  placeholder: string;
  onCommit: (next: string) => void;
  selectionSource?: string;
}) {
  return (
    <div className="flex gap-1.5 items-baseline">
      <span className="shrink-0 w-7 text-[9px] font-mono uppercase tracking-wider text-muted-foreground/70 pt-0.5">
        {label}
      </span>
      <span
        data-selection-source={selectionSource}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={`编辑${label}`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            (e.currentTarget as HTMLElement).blur();
          }
        }}
        onBlur={(e) => {
          const next = (e.currentTarget.innerText || '').trim();
          if (next !== value) onCommit(next);
          else e.currentTarget.innerText = value;
        }}
        className="flex-1 min-w-0 text-[11px] leading-relaxed text-foreground/90 select-text cursor-text outline-none rounded-sm px-1 -mx-1 empty:before:content-[attr(data-ph)] empty:before:text-muted-foreground/40 focus:bg-foreground/[0.05] focus:ring-1 focus:ring-[var(--nayin-accent)]/40 hover:bg-foreground/[0.03] transition-colors"
        data-ph={placeholder}
      >
        {value}
      </span>
    </div>
  );
}

const EMPTY_TABLE_MSG: Record<NayinElement, string> = {
  metal: '导入素材并运行分析，让啤酒帮你拆解镜头提示词矩阵',
  wood: '导入素材并运行分析，在龙井茶香里拆解镜头提示词矩阵',
  water: '导入素材并运行分析，在椰汁清爽里拆解镜头提示词矩阵',
  fire: '导入素材并运行分析，在大红袍暖意里拆解镜头提示词矩阵',
  earth: '导入素材并运行分析，在咖啡香气里拆解镜头提示词矩阵',
};

function EmptyTable() {
  const { element } = useNayin();
  return (
    <div className="p-8 workshop-empty-illustration">
      <ShotStageIllustration stage="idea_pool" size={132} />
      <p className="text-xs text-muted-foreground">{EMPTY_TABLE_MSG[element]}</p>
      <p className="text-[11px] text-muted-foreground/70 max-w-[18rem]">
        这里会把每个镜头拆成场景语义、镜头语言、光影色彩和最终生成 prompt，方便逐镜头进入制作。
      </p>
    </div>
  );
}

interface ShotTableProps {
  isActive: boolean;
  shots: BackendShot[];
  projectId: number | null;
  /** Raw story shots, for lossless inline editing of script fields. */
  storyShots?: StoryShot[];
  onEditShotField?: (
    index: number,
    field: EditableShotField,
    value: string,
  ) => void;
  /** Currently focused shot (highlighted row) */
  focusShotNo?: string | null;
  /** Called when user clicks a shot row */
  onShotClick?: (shotNo: string) => void;
  /** Creation 侧编辑真 shots 表里的最终出图 prompt。 */
  onEditShotPrompt?: (shotId: number, promptDraft: string) => void | Promise<void>;
  /** 提示词片段池（用于显示 / 挑选图像片段） */
  promptPool?: PromptFragment[];
  /** 更新某镜引用的片段 ID 列表 */
  onUpdateFragmentRefs?: (shotIndex: number, fragmentIds: string[]) => void;
}

function compactJoin(parts: Array<string | null | undefined>, sep = ', ') {
  return parts
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .join(sep);
}

function getPriorityRank(priority: Priority): number {
  const rank: Record<Priority, number> = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  return rank[priority];
}

function PromptCell({
  value,
  label,
  shotNo,
  onCommit,
}: {
  value: string;
  label: string;
  shotNo: string;
  onCommit?: (next: string) => void | Promise<void>;
}) {
  const isEditable = Boolean(onCommit);
  const onCopy = async () => {
    if (!value || value === '—') {
      toast.info('该镜头此字段暂无提示词');
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`已复制 ${shotNo} · ${label}`);
    } catch {
      toast.error('复制失败，请手动复制');
    }
  };

  return (
    <div
      className="group relative min-h-[84px] rounded-md border px-2.5 py-2 pr-9"
      style={{ borderColor: 'var(--panel-border)', background: 'var(--background)' }}
    >
      <button
        type="button"
        onClick={onCopy}
        className="absolute right-1.5 top-1.5 w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--muted)]"
        aria-label={`复制 ${label}`}
      >
        <Copy className="w-3.5 h-3.5 text-muted-foreground" />
      </button>
      {isEditable ? (
        <div
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label={`编辑 ${shotNo} · ${label}`}
          tabIndex={0}
          data-ph="点击编辑 prompt"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              (e.currentTarget as HTMLElement).blur();
            }
          }}
          onBlur={(e) => {
            const next = (e.currentTarget.innerText || '').trim();
            if (next && next !== value) {
              void onCommit?.(next);
            } else {
              e.currentTarget.innerText = value === '—' ? '' : value;
            }
          }}
          className="min-h-[64px] text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/90 select-text cursor-text outline-none rounded-sm px-1 -mx-1 empty:before:content-[attr(data-ph)] empty:before:text-muted-foreground/40 focus:bg-foreground/[0.05] focus:ring-1 focus:ring-[var(--nayin-accent)]/40 hover:bg-foreground/[0.03] transition-colors"
        >
          {value === '—' ? '' : value}
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
          {value || '—'}
        </p>
      )}
    </div>
  );
}

const TAG_COLORS: Record<FragmentTag, string> = {
  '风格': 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  '色彩': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  '构图': 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  '情绪': 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  '主体': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  '光线': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
};

/** 单个片段标签 */
function FragmentBadge({
  fragment,
  onRemove,
}: {
  fragment: PromptFragment;
  onRemove?: () => void;
}) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] leading-tight ${TAG_COLORS[fragment.tag]}`}
    >
      <span className="opacity-60">{fragment.tag}</span>
      <span className="font-medium">{fragment.text.length > 12 ? fragment.text.slice(0, 12) + '…' : fragment.text}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-0.5 opacity-50 hover:opacity-100"
          aria-label={`移除片段「${fragment.text}」`}
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </span>
  );
}

/** 从池里挑片段的内联下拉 */
function FragmentPicker({
  pool,
  currentRefs,
  onAdd,
}: {
  pool: PromptFragment[];
  currentRefs: string[];
  onAdd: (fragmentId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const refSet = new Set(currentRefs);
  const available = pool.filter((f) => !refSet.has(f.id));
  const grouped = groupByTag(
    search
      ? available.filter((f) => f.text.includes(search) || f.tag.includes(search))
      : available,
  );

  if (available.length === 0) return null;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-muted-foreground hover:bg-muted/50 transition-colors"
        aria-label="从池里挑片段"
      >
        <Plus className="w-3 h-3" />
        <span>挑片段</span>
      </button>
      {open && (
        <div
          className="absolute z-50 top-full left-0 mt-1 w-56 max-h-64 overflow-auto rounded-lg border bg-popover shadow-lg p-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索片段..."
            className="w-full text-[11px] px-2 py-1 rounded border bg-background mb-1 focus:outline-none focus:ring-1 focus:ring-ring"
            autoFocus
          />
          {(Object.entries(grouped) as [FragmentTag, PromptFragment[]][]).map(([tag, frags]) =>
            frags.length > 0 ? (
              <div key={tag} className="mb-1">
                <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/70 px-1 py-0.5">
                  {tag}
                </div>
                {frags.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => { onAdd(f.id); setOpen(false); setSearch(''); }}
                    className="w-full text-left px-2 py-1 text-[11px] rounded hover:bg-muted/50 transition-colors truncate"
                  >
                    {f.text}
                  </button>
                ))}
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

/** 该镜引用的图像片段列表 + 池挑选器 */
function ShotFragmentsCell({
  shotIndex,
  fragmentRefs,
  pool,
  onUpdateRefs,
}: {
  shotIndex: number;
  fragmentRefs: string[];
  pool: PromptFragment[];
  onUpdateRefs: (shotIndex: number, refs: string[]) => void;
}) {
  const poolMap = useMemo(() => {
    const m = new Map<string, PromptFragment>();
    for (const f of pool) m.set(f.id, f);
    return m;
  }, [pool]);

  const referenced = fragmentRefs.map((id) => poolMap.get(id)).filter(Boolean) as PromptFragment[];
  const hasNoRefs = referenced.length === 0 && pool.length > 0;

  return (
    <div className="space-y-1 min-h-[28px]">
      <div className="flex flex-wrap gap-1 items-start">
        {referenced.map((f) => (
          <FragmentBadge
            key={f.id}
            fragment={f}
            onRemove={() => {
              onUpdateRefs(shotIndex, fragmentRefs.filter((id) => id !== f.id));
            }}
          />
        ))}
        <FragmentPicker
          pool={pool}
          currentRefs={fragmentRefs}
          onAdd={(id) => onUpdateRefs(shotIndex, [...fragmentRefs, id])}
        />
      </div>
      {hasNoRefs && <GapReminder pool={pool} />}
    </div>
  );
}

export default function ShotTable({
  isActive,
  shots,
  projectId,
  storyShots,
  onEditShotField,
  focusShotNo,
  onShotClick,
  onEditShotPrompt,
  promptPool,
  onUpdateFragmentRefs,
}: ShotTableProps) {
  const canEditScript = Boolean(storyShots && onEditShotField);
  const [sortBy, setSortBy] = useState<'scene' | 'priority' | 'deadline' | 'readiness'>('scene');
  const [filterStatus, setFilterStatus] = useState<ShotStatus | 'all'>('all');

  const filteredShots = useMemo(() => {
    let result = [...shots];
    if (filterStatus !== 'all') result = result.filter((s) => s.status === filterStatus);

    result.sort((a, b) => {
      if (sortBy === 'scene') {
        const aKey = `${a.sceneNo}-${a.shotNo}`;
        const bKey = `${b.sceneNo}-${b.shotNo}`;
        return aKey.localeCompare(bKey);
      }
      if (sortBy === 'priority') return getPriorityRank(a.priority) - getPriorityRank(b.priority);
      if (sortBy === 'readiness') return b.readinessScore - a.readinessScore;

      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    });
    return result;
  }, [shots, filterStatus, sortBy]);

  const statusOptions: { value: ShotStatus | 'all'; label: string }[] = [
    { value: 'all', label: 'All Status' },
    { value: 'idea_pool', label: 'Idea Pool' },
    { value: 'requirement_pool', label: 'Requirement' },
    { value: 'structured', label: 'Structured' },
    { value: 'production_ready', label: 'Prod Ready' },
    { value: 'queued', label: 'Queued' },
    { value: 'rendered', label: 'Rendered' },
    { value: 'blocked', label: 'Blocked' },
  ];

  return (
    <div className="monitor-panel">
      <div className="monitor-panel-header justify-between flex-wrap gap-y-1.5">
        <div className="flex items-center gap-2">
          <div className="status-dot" />
          <span>Shot Production Table</span>
          <span className="text-[10px] opacity-50">{filteredShots.length} SHOTS</span>
          {projectId ? (
            <span className="text-[10px] opacity-35">PID:{projectId}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(['idea_pool', 'requirement_pool', 'structured', 'production_ready', 'queued', 'rendered', 'blocked'] as ShotStatus[]).map((status) => {
            const config = STATUS_CONFIG[status];
            return (
              <span
                key={status}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider"
                style={{
                  borderColor: config.color,
                  background: config.bgColor,
                  color: config.color,
                }}
              >
                <span
                  className="w-1 h-1 rounded-full"
                  style={{ background: config.color }}
                />
                {config.label}
              </span>
            );
          })}
        </div>
      </div>

      {!isActive || shots.length === 0 ? (
        <EmptyTable />
      ) : (
        <>
          <div
            className="flex items-center gap-2 px-3 py-2 border-b flex-wrap"
            style={{ borderColor: 'var(--panel-border)' }}
          >
            <select
              className="text-[11px] font-mono px-2 py-1 rounded border bg-transparent text-foreground"
              style={{ borderColor: 'var(--panel-border)' }}
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as ShotStatus | 'all')}
            >
              {statusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <select
              className="text-[11px] font-mono px-2 py-1 rounded border bg-transparent text-foreground"
              style={{ borderColor: 'var(--panel-border)' }}
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            >
              <option value="scene">Sort: Scene/Shot</option>
              <option value="priority">Sort: Priority</option>
              <option value="deadline">Sort: Deadline</option>
              <option value="readiness">Sort: Readiness</option>
            </select>
            <span className="text-[10px] text-muted-foreground font-mono">
              每行为一个镜头，每列为一个提示词维度
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[1720px]">
              <thead>
                <tr
                  className="text-left text-[10px] font-mono uppercase tracking-wider text-muted-foreground"
                  style={{ background: 'var(--panel-header)' }}
                >
                  <th className="px-2.5 py-2 w-[80px]">Scene</th>
                  <th className="px-2.5 py-2 w-[90px]">Shot</th>
                  {onShotClick && <th className="px-2.5 py-2 w-[64px]">主图</th>}
                  <th className="px-2.5 py-2 w-[110px]">Status</th>
                  <th className="px-2.5 py-2 w-[90px]">Ready</th>
                  {canEditScript ? (
                    <th className="px-2.5 py-2 min-w-[240px]">剧本 Script · 可改</th>
                  ) : null}
                  {promptPool && promptPool.length > 0 && onUpdateFragmentRefs && (
                    <th className="px-2.5 py-2 min-w-[200px]">视觉片段</th>
                  )}
                  <th className="px-2.5 py-2 min-w-[210px]">场景语义 Prompt</th>
                  <th className="px-2.5 py-2 min-w-[210px]">镜头语言 Prompt</th>
                  <th className="px-2.5 py-2 min-w-[210px]">光影色彩 Prompt</th>
                  <th className="px-2.5 py-2 min-w-[270px]">生成主 Prompt</th>
                  <th className="px-2.5 py-2 min-w-[250px]">Negative Prompt</th>
                </tr>
              </thead>
              <tbody>
                {filteredShots.map((shot) => {
                  const statusConfig = STATUS_CONFIG[shot.status];
                  const scenePrompt = compactJoin([
                    shot.sceneType,
                    shot.timeOfDay,
                    shot.weather,
                    shot.mood,
                    shot.sourceSummary,
                  ]);
                  const cameraPrompt = compactJoin([
                    shot.cameraMovement,
                    shot.cameraFocalLength ? `focal ${shot.cameraFocalLength}` : null,
                    shot.spatialLayers,
                  ]);
                  const lookPrompt = compactJoin([
                    shot.lighting,
                    shot.colorPalette,
                  ]);
                  const mainPrompt = shot.promptDraft?.trim() || '—';
                  const negative = shot.negativePrompt?.trim() || '—';
                  const srcIdx = shot.sourceIndex;
                  const raw =
                    canEditScript && srcIdx != null ? storyShots?.[srcIdx] : undefined;

                  const isFocused = focusShotNo === shot.shotNo;

                  return (
                    <tr
                      key={shot.id}
                      className={`align-top border-b ${onShotClick ? 'cursor-pointer hover:bg-foreground/[0.03]' : ''} ${isFocused ? 'bg-[var(--nayin-accent)]/10 ring-1 ring-inset ring-[var(--nayin-accent)]/30' : ''}`}
                      style={{ borderColor: 'var(--panel-border)' }}
                      onClick={() => onShotClick?.(shot.shotNo)}
                    >
                      <td className="px-2.5 py-2.5 font-mono font-semibold text-foreground">
                        {shot.sceneNo}
                      </td>
                      <td className="px-2.5 py-2.5 font-mono text-nayin">{shot.shotNo}</td>
                      {onShotClick && (
                        <td
                          className="px-1 py-1"
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const data = e.dataTransfer.getData('text/plain');
                            try {
                              const parsed = JSON.parse(data) as { imageId: number; fromShotNo: string };
                              if (parsed.fromShotNo !== shot.shotNo && parsed.imageId) {
                                onShotClick(shot.shotNo);
                                window.dispatchEvent(new CustomEvent('dt:reassign-image', {
                                  detail: { imageId: parsed.imageId, newShotNo: shot.shotNo },
                                }));
                              }
                            } catch { /* invalid drag data */ }
                          }}
                        >
                          {shot.thumbnailUrl ? (
                            <img
                              src={shot.thumbnailUrl}
                              alt={`${shot.shotNo} 主图`}
                              className="w-12 h-8 rounded object-cover border border-border/50"
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData('text/plain', JSON.stringify({
                                  imageId: shot.thumbnailImageId ?? 0,
                                  fromShotNo: shot.shotNo,
                                }));
                              }}
                            />
                          ) : (
                            <div className="w-12 h-8 rounded bg-muted/30 border border-dashed border-border/30" />
                          )}
                        </td>
                      )}
                      <td className="px-2.5 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-[112px]">
                          <div className="workshop-mini-stage">
                            <ShotStageIllustration stage={shot.status} size={34} animated={false} />
                          </div>
                          <span
                            className="status-badge"
                            style={{
                              background: statusConfig?.bgColor ?? 'var(--muted)',
                              color: statusConfig?.color ?? 'var(--foreground)',
                            }}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ background: statusConfig?.color ?? 'var(--foreground)' }}
                            />
                            {statusConfig?.label ?? shot.status}
                          </span>
                        </div>
                      </td>
                      <td className="px-2.5 py-2.5">
                        <span className="text-[11px] font-mono text-muted-foreground">
                          {Math.round(shot.readinessScore * 100)}%
                        </span>
                      </td>
                      {canEditScript ? (
                        <td className="px-2.5 py-2.5">
                          {raw && srcIdx != null ? (
                            <div
                              className="rounded-md border px-2.5 py-2 space-y-1.5"
                              style={{
                                borderColor: 'var(--panel-border)',
                                background: 'var(--background)',
                              }}
                            >
                              <EditableLine
                                label="主体"
                                value={raw.subject}
                                placeholder="（谁/什么在画面里）"
                                onCommit={(v) => onEditShotField?.(srcIdx, 'subject', v)}
                                selectionSource={`shot:${srcIdx}:subject`}
                              />
                              <EditableLine
                                label="动作"
                                value={raw.action}
                                placeholder="（发生了什么）"
                                onCommit={(v) => onEditShotField?.(srcIdx, 'action', v)}
                                selectionSource={`shot:${srcIdx}:action`}
                              />
                              <EditableLine
                                label="台词"
                                value={raw.dialogue}
                                placeholder="（无台词）"
                                onCommit={(v) => onEditShotField?.(srcIdx, 'dialogue', v)}
                                selectionSource={`shot:${srcIdx}:dialogue`}
                              />
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground/50">—</span>
                          )}
                        </td>
                      ) : null}
                      {promptPool && promptPool.length > 0 && onUpdateFragmentRefs && (
                        <td className="px-2.5 py-2.5">
                          <ShotFragmentsCell
                            shotIndex={srcIdx ?? -1}
                            fragmentRefs={raw?.fragmentRefs ?? []}
                            pool={promptPool}
                            onUpdateRefs={onUpdateFragmentRefs}
                          />
                        </td>
                      )}
                      <td className="px-2.5 py-2.5">
                        <PromptCell value={scenePrompt || '—'} label="场景语义 Prompt" shotNo={shot.shotNo} />
                      </td>
                      <td className="px-2.5 py-2.5">
                        <PromptCell value={cameraPrompt || '—'} label="镜头语言 Prompt" shotNo={shot.shotNo} />
                      </td>
                      <td className="px-2.5 py-2.5">
                        <PromptCell value={lookPrompt || '—'} label="光影色彩 Prompt" shotNo={shot.shotNo} />
                      </td>
                      <td className="px-2.5 py-2.5">
                        <PromptCell
                          value={mainPrompt}
                          label="生成主 Prompt"
                          shotNo={shot.shotNo}
                          onCommit={
                            onEditShotPrompt
                              ? (next) => onEditShotPrompt(shot.id, next)
                              : undefined
                          }
                        />
                      </td>
                      <td className="px-2.5 py-2.5">
                        <PromptCell value={negative} label="Negative Prompt" shotNo={shot.shotNo} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
