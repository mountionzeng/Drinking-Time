/**
 * TemplateDraft — Environment template draft summary panel
 * Design: Monitor panel with mood/lighting/spatial/camera preview modules
 * Now connected to backend via tRPC for real analysis data
 */
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useNayin } from '@/features/nayin/NayinContext';
import type { NayinElement } from '@/features/nayin/nayin';
import { Sparkles, Loader2 } from 'lucide-react';
import ShotStageIllustration from './ShotStageIllustration';
import type { AnalysisData } from '@/features/analysis/types';

const EMPTY_MESSAGES: Record<NayinElement, { text: string; hint: string }> = {
  metal: {
    text: '分析结果正在酝酿中',
    hint: '像啤酒发酵一样，好东西需要一点时间',
  },
  wood: {
    text: '分析结果还在泡茶中',
    hint: '龙井需要 80 度水温，分析需要好素材',
  },
  water: {
    text: '分析结果正在路上',
    hint: '像椰子一样，敲开就有惊喜',
  },
  fire: {
    text: '分析结果正在冲泡',
    hint: '大红袍讲究功夫，分析也是',
  },
  earth: {
    text: '分析结果正在萃取',
    hint: '像意式浓缩一样，精华需要压力和时间',
  },
};

interface TemplateDraftProps {
  isActive: boolean;
  analysis: AnalysisData | null;
  refsCount: number;
  onRunAnalysis: () => Promise<void>;
  isAnalyzing: boolean;
}

function TagGroup({ title, tags, delay }: { title: string; tags: string[]; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
        {title}
      </h4>
      <div className="flex flex-wrap gap-1">
        {tags.map((tag) => (
          <span
            key={tag}
            className="px-2 py-0.5 rounded text-[11px] font-mono"
            style={{
              background: 'var(--nayin-glow)',
              color: 'var(--nayin-accent-bright)',
            }}
          >
            {tag}
          </span>
        ))}
      </div>
    </motion.div>
  );
}

function parseTags(value: string | null): string[] {
  if (!value) return [];
  // Try JSON parse first
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Fall through
  }
  // Split by comma or semicolon
  return value.split(/[,;，；]/).map(s => s.trim()).filter(Boolean);
}

export default function TemplateDraft({ isActive, analysis, refsCount, onRunAnalysis, isAnalyzing }: TemplateDraftProps) {
  const { element } = useNayin();
  const emptyMsg = EMPTY_MESSAGES[element];

  const moodTags = parseTags(analysis?.mood ?? null);
  const lightingTags = parseTags(analysis?.lighting ?? null);
  const spatialTags = parseTags(analysis?.spatialStructure ?? null);
  const cameraTags = parseTags(analysis?.cameraLanguage ?? null);
  const atmosphereKeywords = analysis?.atmosphereKeywords
    ? (Array.isArray(analysis.atmosphereKeywords) ? analysis.atmosphereKeywords as string[] : [])
    : [];

  return (
    <div className="monitor-panel h-full flex flex-col">
      <div className="monitor-panel-header">
        <div className="status-dot" />
        <span>Template Draft</span>
        <span className="ml-auto text-[10px] opacity-50">PREVIEW</span>
      </div>
      <div className="monitor-panel-body flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {!isActive || !analysis ? (
            <motion.div
              key="inactive"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="workshop-empty-illustration h-full justify-center py-8"
            >
              <ShotStageIllustration stage="structured" size={126} />
              <Sparkles className="w-5 h-5 text-muted-foreground opacity-40" />
              <div>
                <p className="text-xs text-muted-foreground">
                  {emptyMsg.text}
                </p>
                <p className="text-[10px] text-muted-foreground opacity-60 mt-1 max-w-[200px]">
                  {emptyMsg.hint}
                </p>
              </div>
              {refsCount > 0 && (
                <Button
                  size="sm"
                  className="text-xs mt-2"
                  style={{ background: 'var(--nayin-accent)', color: 'var(--background)' }}
                  onClick={onRunAnalysis}
                  disabled={isAnalyzing}
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      分析中...
                    </>
                  ) : (
                    '开始分析'
                  )}
                </Button>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="active"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              {/* Tag groups from analysis */}
              {moodTags.length > 0 && <TagGroup title="Mood" tags={moodTags} delay={0.1} />}
              {lightingTags.length > 0 && <TagGroup title="Lighting" tags={lightingTags} delay={0.15} />}
              {spatialTags.length > 0 && <TagGroup title="Spatial Structure" tags={spatialTags} delay={0.2} />}
              {cameraTags.length > 0 && <TagGroup title="Camera Language" tags={cameraTags} delay={0.25} />}
              {atmosphereKeywords.length > 0 && <TagGroup title="Atmosphere" tags={atmosphereKeywords} delay={0.3} />}

              {/* Summary card */}
              {analysis.summary && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35 }}
                  className="rounded-md p-3 border"
                  style={{
                    background: 'var(--panel-header)',
                    borderColor: 'var(--panel-border)',
                  }}
                >
                  <div className="flex items-start gap-3 mb-2">
                    <div className="workshop-mini-stage">
                      <ShotStageIllustration stage="structured" size={34} animated={false} />
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-mono font-semibold text-foreground block">
                        Environment Template Draft
                      </span>
                      <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                        Reusable cinematic environment block
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">
                    {analysis.summary}
                  </p>
                  <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
                    <span>{refsCount} refs</span>
                  </div>
                </motion.div>
              )}

              {/* Prompt draft */}
              {analysis.promptDraft && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="rounded-md p-3 border"
                  style={{
                    background: 'var(--panel-header)',
                    borderColor: 'var(--panel-border)',
                  }}
                >
                  <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1.5">
                    Prompt Draft
                  </h4>
                  <p className="text-[11px] text-foreground leading-relaxed font-mono">
                    {analysis.promptDraft}
                  </p>
                </motion.div>
              )}

              {/* Actions */}
              <div className="flex flex-col gap-2">
                <Button
                  size="sm"
                  className="w-full text-xs"
                  style={{ background: 'var(--nayin-accent)', color: 'var(--background)' }}
                  onClick={onRunAnalysis}
                  disabled={isAnalyzing}
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      重新分析中...
                    </>
                  ) : (
                    '重新分析'
                  )}
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
