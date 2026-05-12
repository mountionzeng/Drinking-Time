import { AnimatePresence, motion } from 'framer-motion';
import { Clock, X } from 'lucide-react';
import Timeline from '../views/Timeline';
import type { BackendReference } from '@/features/analysis/types';

interface AnalysisTimelineDrawerProps {
  isActive: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number | null;
  references: BackendReference[];
  onPin: (ref: BackendReference) => Promise<void>;
  onExclude: (ref: BackendReference) => Promise<void>;
}

export default function AnalysisTimelineDrawer({
  isActive,
  open,
  onOpenChange,
  projectId,
  references,
  onPin,
  onExclude,
}: AnalysisTimelineDrawerProps) {
  return (
    <>
      <motion.button
        type="button"
        onClick={() => onOpenChange(true)}
        aria-label="Open timeline"
        aria-expanded={open}
        className="fixed left-0 top-1/2 -translate-y-1/2 z-40 group flex flex-col items-center gap-2 pl-1.5 pr-2 py-4 rounded-r-2xl border border-l-0 backdrop-blur-md transition-all duration-300"
        style={{
          background:
            'linear-gradient(90deg, oklch(1 0 0 / 92%), oklch(0.98 0.008 75 / 78%))',
          borderColor: 'var(--panel-border)',
          boxShadow:
            '0 8px 32px -8px var(--nayin-glow), 0 1px 2px oklch(0.24 0.012 55 / 8%)',
        }}
        initial={{ x: -8, opacity: 0 }}
        animate={{
          x: open ? -60 : 0,
          opacity: open ? 0 : 0.75,
        }}
        whileHover={{ opacity: 1, x: 2 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <Clock className="w-3.5 h-3.5 text-nayin-bright" />
        <span
          className="text-[10px] font-mono font-semibold tracking-[0.32em] text-foreground/80"
          style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
        >
          TIMELINE
        </span>
        {references.length > 0 && (
          <span
            className="min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[9px] font-mono font-semibold"
            style={{
              background: 'var(--nayin-accent)',
              color: 'var(--background)',
              boxShadow: '0 0 8px var(--nayin-glow)',
            }}
          >
            {references.length}
          </span>
        )}
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={() => onOpenChange(false)}
            />
            <motion.aside
              className="fixed left-0 top-0 bottom-0 z-50 w-[340px] max-w-[85vw] flex flex-col border-r"
              style={{
                background:
                  'linear-gradient(180deg, oklch(1 0 0 / 96%), oklch(0.98 0.008 75 / 96%))',
                borderColor: 'var(--panel-border)',
                backdropFilter: 'blur(24px) saturate(140%)',
                WebkitBackdropFilter: 'blur(24px) saturate(140%)',
                boxShadow:
                  '24px 0 60px -20px oklch(0.24 0.012 55 / 18%), 1px 0 0 0 var(--nayin-glow)',
              }}
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <div
                className="absolute right-0 top-0 bottom-0 w-px"
                style={{
                  background:
                    'linear-gradient(180deg, transparent, var(--nayin-accent) 30%, var(--nayin-accent) 70%, transparent)',
                  opacity: 0.4,
                }}
              />
              <div className="flex items-center justify-between px-5 pt-5 pb-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-1 h-4 rounded-full"
                    style={{
                      background: 'var(--nayin-accent)',
                      boxShadow: '0 0 10px var(--nayin-glow)',
                    }}
                  />
                  <span className="text-xs font-semibold tracking-[0.24em] uppercase text-foreground">
                    Timeline
                  </span>
                </div>
                <button
                  onClick={() => onOpenChange(false)}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
                  aria-label="Close timeline"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 min-h-0 px-3 pb-4">
                <Timeline
                  projectId={projectId}
                  references={references}
                  isActive={isActive}
                  onPin={onPin}
                  onExclude={onExclude}
                />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
