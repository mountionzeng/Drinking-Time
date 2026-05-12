/**
 * Timeline — Day-bucketed reference material timeline
 * Design: Monitor panel with day buckets and material cards
 * Now connected to backend via tRPC for real reference data
 */
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pin, X, ChevronDown, ChevronRight, Clock, Eye } from 'lucide-react';
import { useNayin } from '@/contexts/NayinContext';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import type { NayinElement } from '@/lib/nayin';
import { SOURCE_TYPE_CONFIG, type SourceType } from '@/lib/mockData';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { BackendReference } from '@/features/analysis/types';

const EMPTY_MESSAGES: Record<NayinElement, string> = {
  metal: '先喝口啤酒，等素材进来就能看到时间轴了',
  wood: '泡上茶，导入素材后时间轴就会出现',
  water: '开个椰汁，等素材导入后时间轴就好了',
  fire: '先品口茶，导入素材后时间轴自然展开',
  earth: '先喝口咖啡，导入素材后时间轴就来',
};

function EmptyTimeline() {
  const { theme, element } = useNayin();
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center h-full text-center py-8 gap-3"
    >
      <motion.span
        className="text-2xl"
        animate={{ y: [0, -4, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      >
        {theme.emoji}
      </motion.span>
      <Clock className="w-5 h-5 text-muted-foreground opacity-40" />
      <p className="text-xs text-muted-foreground max-w-[180px]">
        {EMPTY_MESSAGES[element]}
      </p>
    </motion.div>
  );
}

interface TimelineProps {
  isActive: boolean;
  projectId: number | null;
  references: BackendReference[];
}

function ImportanceStars({ value }: { value: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: i <= value ? 'var(--nayin-accent)' : 'var(--muted)',
          }}
        />
      ))}
    </div>
  );
}

function FragmentCard({ fragment, onPin, onExclude, onPreview }: {
  fragment: BackendReference;
  onPin: () => void;
  onExclude: () => void;
  onPreview: () => void;
}) {
  const sourceType = fragment.sourceType as SourceType;
  const config = SOURCE_TYPE_CONFIG[sourceType] || SOURCE_TYPE_CONFIG['note'];
  const sizeClass = fragment.importance >= 4 ? 'p-2.5' : 'p-2';
  const hasImagePreview =
    (sourceType === 'image' || sourceType === 'storyboard') &&
    Boolean(fragment.fileUrl);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-md border transition-colors hover:border-[var(--nayin-accent)] group ${sizeClass} ${
        fragment.excluded ? 'opacity-40' : ''
      }`}
      style={{
        background: 'var(--card)',
        borderColor: fragment.pinned ? 'var(--nayin-accent)' : 'var(--panel-border)',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[10px]">{config.icon}</span>
            <span
              className="text-[10px] font-mono uppercase"
              style={{ color: config.color }}
            >
              {config.label}
            </span>
            {fragment.pinned && (
              <Pin className="w-2.5 h-2.5 text-nayin" />
            )}
          </div>
          <p className="text-xs text-foreground leading-snug truncate">
            {fragment.title}
          </p>
          {fragment.fileSize && (
            <p className="text-[9px] text-muted-foreground mt-0.5 font-mono">
              {(fragment.fileSize / 1024).toFixed(1)} KB
            </p>
          )}
          {hasImagePreview && fragment.fileUrl && (
            <button
              type="button"
              onClick={onPreview}
              className="mt-1.5 block w-full rounded border border-[var(--panel-border)] overflow-hidden hover:border-[var(--nayin-accent)] transition-colors"
            >
              <img
                src={fragment.fileUrl}
                alt={fragment.title}
                className="w-full h-20 object-cover"
                loading="lazy"
              />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {hasImagePreview && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="w-5 h-5 rounded flex items-center justify-center hover:bg-[var(--muted)]"
                  onClick={onPreview}
                >
                  <Eye className="w-3 h-3 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top"><p className="text-xs">View image</p></TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="w-5 h-5 rounded flex items-center justify-center hover:bg-[var(--muted)]"
                onClick={onPin}
              >
                <Pin className="w-3 h-3 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top"><p className="text-xs">{fragment.pinned ? 'Unpin' : 'Pin'}</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="w-5 h-5 rounded flex items-center justify-center hover:bg-[var(--muted)]"
                onClick={onExclude}
              >
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top"><p className="text-xs">Exclude</p></TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <ImportanceStars value={fragment.importance} />
      </div>
    </motion.div>
  );
}

export default function Timeline({ isActive, projectId, references }: TimelineProps) {
  const updateRefMut = trpc.reference.update.useMutation();
  const utils = trpc.useUtils();

  // Compute default expanded buckets from data
  const buckets = useMemo(() => {
    const map = new Map<string, BackendReference[]>();
    references.forEach((f) => {
      const key = f.dateBucket || 'Undated';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(f);
    });
    const entries: [string, BackendReference[]][] = [];
    map.forEach((v, k) => entries.push([k, v]));
    entries.sort((a, b) => {
      if (a[0] === 'Undated') return 1;
      if (b[0] === 'Undated') return -1;
      return a[0].localeCompare(b[0]);
    });
    return entries;
  }, [references]);

  const [expandedBuckets, setExpandedBuckets] = useState<Set<string>>(
    new Set(buckets.map(([k]) => k))
  );
  const [previewRef, setPreviewRef] = useState<BackendReference | null>(null);

  const toggleBucket = (key: string) => {
    setExpandedBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handlePin = async (ref: BackendReference) => {
    try {
      await updateRefMut.mutateAsync({ id: ref.id, pinned: !ref.pinned });
      if (projectId) utils.reference.list.invalidate({ projectId });
      toast.success(ref.pinned ? 'Unpinned' : 'Pinned');
    } catch {
      toast.error('操作失败');
    }
  };

  const handleExclude = async (ref: BackendReference) => {
    try {
      await updateRefMut.mutateAsync({ id: ref.id, excluded: true });
      if (projectId) utils.reference.list.invalidate({ projectId });
      toast.success('已排除');
    } catch {
      toast.error('操作失败');
    }
  };

  const formatDate = (dateStr: string) => {
    if (dateStr === 'Undated') return 'Undated';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="h-full flex flex-col border-r border-foreground/10 pr-3">
      <div className="flex items-center gap-2 pl-1 pr-2 py-2.5 border-b border-foreground/10 mb-3">
        <div
          className="w-1 h-4 rounded-full"
          style={{ background: 'var(--nayin-accent)', boxShadow: '0 0 8px var(--nayin-glow)' }}
        />
        <span className="text-xs font-semibold tracking-[0.18em] uppercase text-foreground/90">
          Timeline
        </span>
        <span className="ml-auto text-[10px] font-mono text-muted-foreground/70">
          {references.length} · {buckets.length}d
        </span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 custom-scrollbar">
        <AnimatePresence>
          {!isActive || references.length === 0 ? (
            <EmptyTimeline />
          ) : (
            buckets.map(([date, fragments], bucketIdx) => {
              const isExpanded = expandedBuckets.has(date);
              return (
                <motion.div
                  key={date}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: bucketIdx * 0.08 }}
                >
                  {/* Bucket header */}
                  <button
                    className="w-full flex items-center gap-2 py-1 group"
                    onClick={() => toggleBucket(date)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3 h-3 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-muted-foreground" />
                    )}
                    <span className="text-xs font-mono font-semibold text-nayin">
                      {formatDate(date)}
                    </span>
                    <div className="flex-1 h-px" style={{ background: 'var(--panel-border)' }} />
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {fragments.length}
                    </span>
                  </button>

                  {/* Fragment cards */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-1.5 pl-5 pt-1">
                          {fragments
                            .sort((a, b) => b.importance - a.importance)
                            .map((f) => (
                              <FragmentCard
                                key={f.id}
                                fragment={f}
                                onPin={() => handlePin(f)}
                                onExclude={() => handleExclude(f)}
                                onPreview={() => setPreviewRef(f)}
                              />
                            ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>
      <Dialog open={Boolean(previewRef)} onOpenChange={(open) => { if (!open) setPreviewRef(null); }}>
        <DialogContent className="sm:max-w-3xl p-4">
          {previewRef && (
            <>
              <DialogHeader className="space-y-1">
                <DialogTitle className="text-sm font-semibold truncate pr-8">
                  {previewRef.title}
                </DialogTitle>
                <DialogDescription className="text-xs font-mono uppercase">
                  {previewRef.sourceType}
                </DialogDescription>
              </DialogHeader>
              {previewRef.fileUrl ? (
                <div className="mt-2 rounded-md overflow-hidden border border-[var(--panel-border)] bg-foreground/5">
                  <img
                    src={previewRef.fileUrl}
                    alt={previewRef.title}
                    className="w-full max-h-[70vh] object-contain"
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">图片地址不可用</p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
