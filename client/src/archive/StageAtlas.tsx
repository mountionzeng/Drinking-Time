import ShotStageIllustration, { STAGE_LABEL, type ShotStage } from '@/components/ShotStageIllustration';

const STAGE_META: Record<ShotStage, { line: string; purity: string }> = {
  idea_pool: { line: '灵感仍在水面，意向尚未凝固。', purity: '—' },
  requirement_pool: { line: '需求开始沉淀，边界逐渐显形。', purity: '低' },
  structured: { line: '结构已经成形，主次枝脉被拣出并对齐。', purity: '中' },
  production_ready: { line: '配方已经封坛，火候与分量均已核定。', purity: '高' },
  queued: { line: '排队进入工序，顺位在号。', purity: '—' },
  rendered: { line: '产出已经落桌，等待品鉴。', purity: '9.4 / 10' },
  blocked: { line: '工序暂时搁置，某处杂质需要先被处理。', purity: '—' },
};

const STAGES: ShotStage[] = [
  'idea_pool',
  'requirement_pool',
  'structured',
  'production_ready',
  'queued',
  'rendered',
  'blocked',
];

interface StageAtlasProps {
  selectedStage: ShotStage;
  onSelectStage: (stage: ShotStage) => void;
  size: number;
}

export default function StageAtlas({ selectedStage, onSelectStage, size }: StageAtlasProps) {
  const meta = STAGE_META[selectedStage];

  return (
    <section className="monitor-panel mt-5">
      <div className="monitor-panel-header justify-between">
        <div className="flex items-center gap-2">
          <div className="status-dot" />
          <span>Stage Illustration Atlas</span>
        </div>
        <span className="text-[10px] opacity-50">7 STATES</span>
      </div>

      <div className="monitor-panel-body">
        <div className="flex flex-col items-center gap-4 text-center pb-4">
          <ShotStageIllustration stage={selectedStage} size={Math.max(140, size + 48)} />
          <div>
            <div className="text-sm font-semibold tracking-[0.12em] uppercase text-foreground">
              {STAGE_LABEL[selectedStage]}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{meta.line}</p>
            <p className="mt-2 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
              Purity · {meta.purity}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {STAGES.map((stage) => (
            <button
              key={stage}
              type="button"
              onClick={() => onSelectStage(stage)}
              className={`workshop-atlas-card ${selectedStage === stage ? 'is-active' : ''}`}
            >
              <ShotStageIllustration stage={stage} size={size} animated={selectedStage === stage} />
              <span className="workshop-atlas-label">{STAGE_LABEL[stage]}</span>
            </button>
          ))}
        </div>

        <div className="sheet-colophon mt-3">
          <span>LEDGER · WORKSHOP EDITION</span>
          <span>PLATE 01 / 07 · HAND-INKED</span>
        </div>
      </div>
    </section>
  );
}
