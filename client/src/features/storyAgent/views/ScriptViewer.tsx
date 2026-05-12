/**
 * ScriptViewer — Displays the latest script generated from ordered story cards.
 * Sits in the third (rightmost) slot of the analysis page.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, ScrollText, Sparkles, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { useStoryAgent } from '@/features/storyAgent/StoryAgentContext';
import { useNayin } from '@/features/nayin/NayinContext';
import type { NayinElement } from '@/features/nayin/nayin';

const EMPTY_HINT: Record<NayinElement, string> = {
  metal: '剧本会在这里斟出来 — 像啤酒一样有泡沫与节奏',
  wood: '剧本会在这里慢慢泡开 — 像龙井，初涩后回甘',
  water: '剧本会在这里凝成 — 像椰汁，清爽自然',
  fire: '剧本会在这里冲泡 — 像大红袍，岩韵悠然',
  earth: '剧本会在这里萃取 — 像意式浓缩，浓而不烈',
};

export default function ScriptViewer() {
  const { latestScript, scripts } = useStoryAgent();
  const { element } = useNayin();
  const [copied, setCopied] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const copyAll = async () => {
    if (!latestScript) return;
    const lines = [
      `# ${latestScript.title}`,
      '',
      latestScript.logline,
      '',
      ...latestScript.scenes.map(
        (s) => `${s.sceneNo} · ${s.emotion}\n${s.visual}`,
      ),
      '',
      `情感弧线：${latestScript.arcSummary}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      toast.success('剧本已复制');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('复制失败');
    }
  };

  return (
    <div className="monitor-panel h-full flex flex-col">
      <div className="monitor-panel-header">
        <div className="status-dot" />
        <span>Script</span>
        <span className="ml-auto flex items-center gap-2 text-[10px] opacity-60 font-mono">
          {scripts.length > 0 ? `${scripts.length} ver.` : 'IDLE'}
        </span>
      </div>

      <div className="monitor-panel-body flex-1 overflow-hidden flex flex-col">
        <AnimatePresence mode="wait">
          {!latestScript ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col items-center justify-center text-center gap-3 px-4"
            >
              <ScrollText className="w-7 h-7 text-muted-foreground opacity-40" />
              <p className="text-xs text-muted-foreground max-w-[16rem] leading-relaxed">
                {EMPTY_HINT[element]}
              </p>
              <p className="text-[10px] text-muted-foreground/70 max-w-[16rem]">
                调好顺序后按 <span className="text-nayin-bright">生成剧本</span>，这一段记忆的弧线就会显形。
              </p>
            </motion.div>
          ) : (
            <motion.div
              key={latestScript.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-3"
            >
              {/* Title + logline */}
              <div>
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <h3 className="text-sm font-semibold text-foreground leading-tight">
                    {latestScript.title}
                  </h3>
                  <button
                    type="button"
                    onClick={copyAll}
                    className="shrink-0 w-7 h-7 rounded flex items-center justify-center hover:bg-foreground/5 transition-colors"
                    aria-label="复制剧本"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-[var(--status-ready)]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground italic leading-relaxed">
                  {latestScript.logline}
                </p>
              </div>

              {/* Scenes */}
              <div className="space-y-2">
                {latestScript.scenes.map((s, i) => (
                  <motion.div
                    key={`${latestScript.id}-${i}`}
                    initial={{ opacity: 0, x: 6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="rounded-md border p-2.5"
                    style={{
                      background: 'var(--card)',
                      borderColor: 'var(--panel-border)',
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
                        style={{
                          background: 'var(--nayin-accent)',
                          color: 'var(--background)',
                        }}
                      >
                        {s.sceneNo}
                      </span>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-nayin-bright">
                        {s.emotion}
                      </span>
                    </div>
                    <p className="text-[11.5px] text-foreground leading-relaxed">
                      {s.visual}
                    </p>
                  </motion.div>
                ))}
              </div>

              {/* Arc summary */}
              <div
                className="rounded-md p-2.5 border flex items-start gap-2"
                style={{
                  background: 'var(--nayin-glow)',
                  borderColor: 'oklch(from var(--nayin-accent) l c h / 25%)',
                }}
              >
                <Sparkles className="w-3.5 h-3.5 text-nayin-bright shrink-0 mt-0.5" />
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-0.5">
                    Emotional Arc
                  </div>
                  <p className="text-[11px] text-foreground leading-relaxed">
                    {latestScript.arcSummary}
                  </p>
                </div>
              </div>

              {/* History toggle */}
              {scripts.length > 1 && (
                <div className="border-t pt-2" style={{ borderColor: 'var(--panel-border)' }}>
                  <button
                    type="button"
                    onClick={() => setHistoryOpen(!historyOpen)}
                    className="w-full flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronDown
                      className={`w-3 h-3 transition-transform ${historyOpen ? 'rotate-180' : ''}`}
                    />
                    历史版本 ({scripts.length - 1})
                  </button>
                  {historyOpen && (
                    <div className="mt-2 space-y-1.5">
                      {scripts.slice(0, -1).reverse().map((s) => (
                        <div
                          key={s.id}
                          className="rounded p-2 text-[10px] text-muted-foreground"
                          style={{ background: 'var(--panel-header)' }}
                        >
                          <span className="font-semibold text-foreground/80">{s.title}</span>
                          <span className="ml-1 opacity-60">· {s.scenes.length} 场</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
