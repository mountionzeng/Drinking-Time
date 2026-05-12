/**
 * ShotTable — Shot Production Prompt Matrix
 * Matrix view: one row per shot, one column per prompt dimension.
 */
import { useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useNayin } from '@/features/nayin/NayinContext';
import type { NayinElement } from '@/features/nayin/nayin';
import { STATUS_CONFIG } from '@/features/analysis/config/statusConfig';
import type { Priority, ShotStatus } from '@/features/analysis/types';
import ShotStageIllustration from './ShotStageIllustration';
import type { BackendShot } from '@/features/analysis/types';

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
}: {
  value: string;
  label: string;
  shotNo: string;
}) {
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
      <p className="text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
        {value || '—'}
      </p>
    </div>
  );
}

export default function ShotTable({ isActive, shots, projectId }: ShotTableProps) {
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
            <table className="w-full text-xs min-w-[1520px]">
              <thead>
                <tr
                  className="text-left text-[10px] font-mono uppercase tracking-wider text-muted-foreground"
                  style={{ background: 'var(--panel-header)' }}
                >
                  <th className="px-2.5 py-2 w-[80px]">Scene</th>
                  <th className="px-2.5 py-2 w-[90px]">Shot</th>
                  <th className="px-2.5 py-2 w-[110px]">Status</th>
                  <th className="px-2.5 py-2 w-[90px]">Ready</th>
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

                  return (
                    <tr
                      key={shot.id}
                      className="align-top border-b"
                      style={{ borderColor: 'var(--panel-border)' }}
                    >
                      <td className="px-2.5 py-2.5 font-mono font-semibold text-foreground">
                        {shot.sceneNo}
                      </td>
                      <td className="px-2.5 py-2.5 font-mono text-nayin">{shot.shotNo}</td>
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
                        <PromptCell value={mainPrompt} label="生成主 Prompt" shotNo={shot.shotNo} />
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
