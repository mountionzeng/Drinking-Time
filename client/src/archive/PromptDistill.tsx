/**
 * PromptDistill — Extracts ready-to-use prompts from the analysis.
 * Design: Monitor panel with one-click copy chips distilled from
 * the TemplateDraft's mood/lighting/camera/atmosphere/promptDraft fields.
 */
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, FlaskConical, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNayin } from '@/contexts/NayinContext';
import type { NayinElement } from '@/lib/nayin';
import { toast } from 'sonner';
import ShotStageIllustration from '@/components/ShotStageIllustration';
import type { AnalysisData } from '@/features/analysis/types';

interface PromptDistillProps {
  isActive: boolean;
  analysis: AnalysisData | null;
}

const EMPTY_HINT: Record<NayinElement, string> = {
  metal: '等分析完成，我来把关键提示词滤出来',
  wood: '等茶汤出味，我来挑出最精华的提示词',
  water: '等分析出结果，我来挑出清爽可用的提示词',
  fire: '等焙火到位，我来萃取最浓的提示词',
  earth: '等萃取结束，我来拉出最香的提示词',
};

function parseTags(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // fall through
  }
  return value.split(/[,;，；]/).map((s) => s.trim()).filter(Boolean);
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      toast.success('已复制到剪贴板');
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
    } catch {
      toast.error('复制失败');
    }
  };
  return { copied, copy };
}

export default function PromptDistill({ isActive, analysis }: PromptDistillProps) {
  const { element } = useNayin();
  const { copied, copy } = useCopy();

  const mood = useMemo(() => parseTags(analysis?.mood ?? null), [analysis]);
  const lighting = useMemo(() => parseTags(analysis?.lighting ?? null), [analysis]);
  const spatial = useMemo(() => parseTags(analysis?.spatialStructure ?? null), [analysis]);
  const camera = useMemo(() => parseTags(analysis?.cameraLanguage ?? null), [analysis]);
  const color = useMemo(() => parseTags(analysis?.colorPalette ?? null), [analysis]);
  const atmosphere = useMemo(
    () =>
      Array.isArray(analysis?.atmosphereKeywords)
        ? (analysis!.atmosphereKeywords as unknown[]).map(String)
        : [],
    [analysis],
  );

  const allKeywords = useMemo(
    () => Array.from(new Set([...mood, ...lighting, ...camera, ...color, ...atmosphere, ...spatial])),
    [mood, lighting, camera, color, atmosphere, spatial],
  );

  const compositePrompt = useMemo(() => {
    if (analysis?.promptDraft && analysis.promptDraft.trim()) return analysis.promptDraft.trim();
    return allKeywords.join(', ');
  }, [analysis?.promptDraft, allKeywords]);

  const hasAnything = isActive && analysis && (compositePrompt || allKeywords.length > 0);

  return (
    <div className="monitor-panel h-full flex flex-col">
      <div className="monitor-panel-header">
        <div className="status-dot" />
        <span>Prompt Distill</span>
        <span className="ml-auto text-[10px] opacity-50">DISTILLED</span>
      </div>
      <div className="monitor-panel-body flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {!hasAnything ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="workshop-empty-illustration h-full justify-center py-8"
            >
              <div className="relative">
                <ShotStageIllustration stage="production_ready" size={126} />
                <FlaskConical className="w-6 h-6 text-nayin opacity-80 absolute right-5 top-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">提示词蒸馏罐</p>
                <p className="text-[10px] text-muted-foreground opacity-60 mt-1 max-w-[220px]">
                  {EMPTY_HINT[element]}
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="active"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              {/* Composite prompt */}
              {compositePrompt && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="rounded-md border p-3"
                  style={{ background: 'var(--panel-header)', borderColor: 'var(--panel-border)' }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      Composite Prompt
                    </h4>
                    <button
                      onClick={() => copy(compositePrompt, 'composite')}
                      className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-nayin-bright transition-colors"
                    >
                      {copied === 'composite' ? (
                        <>
                          <Check className="w-3 h-3" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" /> Copy
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-[11px] text-foreground leading-relaxed font-mono whitespace-pre-wrap">
                    {compositePrompt}
                  </p>
                </motion.div>
              )}

              {/* Negative prompt */}
              {analysis?.negativePrompt && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                  className="rounded-md border p-3"
                  style={{ background: 'var(--panel-header)', borderColor: 'var(--panel-border)' }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Ban className="w-3 h-3" /> Negative
                    </h4>
                    <button
                      onClick={() => copy(analysis.negativePrompt ?? '', 'negative')}
                      className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-nayin-bright transition-colors"
                    >
                      {copied === 'negative' ? (
                        <>
                          <Check className="w-3 h-3" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" /> Copy
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed font-mono whitespace-pre-wrap">
                    {analysis.negativePrompt}
                  </p>
                </motion.div>
              )}

              {/* Keyword chips — click to copy individually */}
              {allKeywords.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      Keywords · 点击复制
                    </h4>
                    <button
                      onClick={() => copy(allKeywords.join(', '), 'keywords')}
                      className="inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-nayin-bright transition-colors"
                    >
                      {copied === 'keywords' ? (
                        <>
                          <Check className="w-3 h-3" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" /> Copy all
                        </>
                      )}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {allKeywords.map((kw, i) => {
                      const key = `kw-${i}`;
                      return (
                        <button
                          key={key}
                          onClick={() => copy(kw, key)}
                          className="px-2 py-0.5 rounded text-[11px] font-mono border transition-all"
                          style={{
                            background: copied === key ? 'var(--nayin-accent)' : 'var(--nayin-glow)',
                            color: copied === key ? 'var(--background)' : 'var(--nayin-accent-bright)',
                            borderColor: 'oklch(from var(--nayin-accent) l c h / 25%)',
                          }}
                        >
                          {copied === key ? '✓ ' : ''}
                          {kw}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* Copy-all mega button */}
              <Button
                size="sm"
                className="w-full text-xs"
                style={{ background: 'var(--nayin-accent)', color: 'var(--background)' }}
                onClick={() =>
                  copy(
                    [compositePrompt, analysis?.negativePrompt ? `Negative: ${analysis.negativePrompt}` : '']
                      .filter(Boolean)
                      .join('\n\n'),
                    'all',
                  )
                }
              >
                {copied === 'all' ? (
                  <>
                    <Check className="w-3 h-3 mr-1" /> 全部已复制
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3 mr-1" /> 复制整套提示词
                  </>
                )}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
