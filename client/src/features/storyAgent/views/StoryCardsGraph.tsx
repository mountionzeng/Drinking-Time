import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GitBranch,
  LocateFixed,
  Sparkles,
  Tags,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { StoryCard, StoryShot } from '@/features/storyAgent/types';

type CausalStepKey =
  | 'role'
  | 'ability'
  | 'cause'
  | 'effect'
  | 'proof'
  | 'contact'
  | 'value';

type CausalStep = {
  key: CausalStepKey;
  label: string;
  location: '岗位' | '能力' | '原因' | '作用' | '证据' | '联系' | '外部价值';
  shortLabel: string;
};

type RelationType = '支撑' | '导致' | '转化为' | '证明' | '带来';

type CausalEdge = {
  from: CausalStepKey;
  to: CausalStepKey;
  type: RelationType;
  label: string;
};

type GraphNode = {
  id: string;
  label: string;
  status: 'ready' | 'ask' | 'evidence' | 'cause' | 'hold';
  stepKey: CausalStepKey;
  stepIndex: number;
  location: CausalStep['location'];
  weight: number;
  shotNo?: number;
  card: StoryCard;
  shot?: StoryShot;
};

type StoryCardsGraphProps = {
  cards: StoryCard[];
  storyShots: StoryShot[];
  onRemoveCard?: (cardId: string) => void;
};

type ViewportState = {
  scale: number;
};

const CAUSAL_STEPS: CausalStep[] = [
  {
    key: 'role',
    label: '岗位关心什么',
    location: '岗位',
    shortLabel: '岗位',
  },
  {
    key: 'ability',
    label: '你有什么能力',
    location: '能力',
    shortLabel: '能力',
  },
  {
    key: 'cause',
    label: '为什么有这个能力',
    location: '原因',
    shortLabel: '原因',
  },
  {
    key: 'effect',
    label: '怎么发生作用',
    location: '作用',
    shortLabel: '作用',
  },
  {
    key: 'proof',
    label: '凭什么相信',
    location: '证据',
    shortLabel: '证据',
  },
  {
    key: 'contact',
    label: '为什么值得联系',
    location: '联系',
    shortLabel: '联系',
  },
  {
    key: 'value',
    label: '外部价值',
    location: '外部价值',
    shortLabel: '价值',
  },
];

const STEP_BY_KEY = Object.fromEntries(
  CAUSAL_STEPS.map((step, index) => [step.key, { ...step, index }]),
) as Record<CausalStepKey, CausalStep & { index: number }>;

const CAUSAL_EDGES: CausalEdge[] = [
  {
    from: 'role',
    to: 'ability',
    type: '支撑',
    label: '回应岗位关注',
  },
  {
    from: 'ability',
    to: 'cause',
    type: '导致',
    label: '长期处理抽象需求',
  },
  {
    from: 'cause',
    to: 'effect',
    type: '转化为',
    label: '把来源变成方法',
  },
  {
    from: 'effect',
    to: 'proof',
    type: '证明',
    label: '案例验证方法',
  },
  {
    from: 'proof',
    to: 'contact',
    type: '证明',
    label: '可信度进入判断',
  },
  {
    from: 'contact',
    to: 'value',
    type: '带来',
    label: '最后产生外部价值',
  },
];

const STATUS_LABEL: Record<GraphNode['status'], string> = {
  ready: '适合成片',
  ask: '继续追问',
  evidence: '补证据',
  cause: '补因果',
  hold: '暂不入片',
};

const STATUS_CLASS: Record<GraphNode['status'], string> = {
  ready: 'border-emerald-500/30 bg-emerald-50 text-emerald-700',
  ask: 'border-cyan-500/35 bg-cyan-50 text-cyan-700',
  evidence: 'border-rose-500/30 bg-rose-50 text-rose-700',
  cause: 'border-amber-500/35 bg-amber-50 text-amber-700',
  hold: 'border-muted-foreground/20 bg-muted text-muted-foreground',
};

const RELATION_CLASS: Record<RelationType, string> = {
  支撑: 'border-cyan-500/30 bg-cyan-50 text-cyan-700',
  导致: 'border-amber-500/35 bg-amber-50 text-amber-700',
  转化为: 'border-emerald-500/30 bg-emerald-50 text-emerald-700',
  证明: 'border-rose-500/30 bg-rose-50 text-rose-700',
  带来: 'border-sky-500/30 bg-sky-50 text-sky-700',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function compact(text: string | undefined | null, fallback: string, length = 62): string {
  const value = text?.replace(/\s+/g, ' ').trim() || fallback;
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function statusFor(card: StoryCard, shot: StoryShot | undefined, index: number): GraphNode['status'] {
  const text = `${card.title} ${card.content} ${shot?.narrativeJob?.evidence ?? ''} ${shot?.rationale ?? ''}`;
  if (shot?.narrativeJob?.visualTranslation || shot?.promptDraft || shot?.promptRun?.finalPrompt) return 'ready';
  if (/案例|作品|证据|反馈|结果|证明|真实/.test(text)) return 'evidence';
  if (/因为|所以|判断|取舍|为什么|因果|来源/.test(text)) return 'cause';
  return index <= 1 ? 'ask' : 'hold';
}

function stepFor(index: number, card: StoryCard, shot: StoryShot | undefined): CausalStepKey {
  const titleText = card.title;
  const leadText = [
    card.title,
    compact(card.content, '', 240),
    card.sourceQuote,
    card.direction,
    card.dramaticFunction,
    shot?.narrativeJob?.claim,
    shot?.rationale,
    shot?.narrativeJob?.visualTranslation,
  ]
    .filter(Boolean)
    .join(' ');

  if (/岗位|职位|招聘|JD|候选|面试|客户/.test(titleText)) return 'role';
  if (/外部价值|业务价值|用户价值|商业|收益|增长/.test(titleText)) return 'value';
  if (/联系|合作|值得|邀约|见面|沟通|信任/.test(titleText)) return 'contact';
  if (/证据|作品|案例|反馈|证明|项目|凭什么|真实/.test(titleText)) return 'proof';
  if (/发生作用|怎么做|转化|落地|流程|方法|画面|模糊需求|变成/.test(titleText)) return 'effect';
  if (/为什么|因为|来源|长期|背景|经历|训练|经验|抽象需求/.test(titleText)) return 'cause';
  if (/能力|优势|擅长|创新力|判断力|审美|表达|组织|抽象|创意/.test(titleText)) return 'ability';

  if (/岗位|职位|招聘|JD|候选|面试|客户/.test(leadText)) return 'role';
  if (/外部价值|业务价值|用户价值|商业|收益|增长|影响/.test(leadText)) return 'value';
  if (/联系|合作|值得|邀约|见面|沟通|信任/.test(leadText)) return 'contact';
  if (/证据|作品|案例|反馈|证明|项目|凭什么|真实/.test(leadText)) return 'proof';
  if (/发生作用|怎么做|转化|落地|流程|方法|画面|模糊需求|变成/.test(leadText)) return 'effect';
  if (/为什么|因为|来源|长期|背景|经历|训练|经验|抽象需求/.test(leadText)) return 'cause';
  if (/能力|优势|擅长|创新力|判断力|审美|表达|组织|抽象|创意/.test(leadText)) return 'ability';

  return CAUSAL_STEPS[Math.min(index + 1, CAUSAL_STEPS.length - 1)].key;
}

function weightFor(card: StoryCard, shot: StoryShot | undefined, status: GraphNode['status']): number {
  let signalScore = 2;
  if (card.sourceQuote || card.rawText) signalScore += 1;
  if (shot?.narrativeJob?.evidence) signalScore += 1;
  if (shot?.narrativeJob?.visualTranslation || shot?.promptRun?.finalPrompt) signalScore += 1;
  if (status === 'ready') signalScore += 1;
  if (status === 'hold') signalScore -= 1;
  signalScore = clamp(signalScore, 1, 5);

  if (typeof card.intensity === 'number' && Number.isFinite(card.intensity)) {
    if (card.intensity > 0 && card.intensity < 1) {
      return clamp(Math.ceil(card.intensity * 5), 1, 5);
    }
    if (card.intensity === 1) {
      return signalScore;
    }
    const normalized = card.intensity <= 5 ? card.intensity : Math.ceil(card.intensity / 2);
    return clamp(Math.max(Math.round(normalized), signalScore), 1, 5);
  }

  return signalScore;
}

function buildGraph(cards: StoryCard[], storyShots: StoryShot[]): GraphNode[] {
  return cards.map((card, index) => {
    const shot = storyShots[index];
    const status = statusFor(card, shot, index);
    const stepKey = stepFor(index, card, shot);
    const step = STEP_BY_KEY[stepKey];

    return {
      id: `card-${card.id}`,
      label: compact(card.title, `优势卡 ${index + 1}`, 28),
      status,
      stepKey,
      stepIndex: step.index,
      location: step.location,
      weight: weightFor(card, shot, status),
      shotNo: index + 1,
      card,
      shot,
    };
  });
}

function readableEvidence(node: GraphNode | undefined): string {
  if (!node) return '还缺一条可以让陌生人相信的真实证据。';
  return compact(
    node.shot?.narrativeJob?.evidence || node.card.sourceQuote || node.card.rawText || node.card.content,
    '还缺一条可以让陌生人相信的真实证据。',
    148,
  );
}

function readableCause(node: GraphNode | undefined): string {
  if (!node) return '需要继续说明：为什么这件事能证明这个优势，以及它如何服务目标机会。';
  return compact(
    node.shot?.rationale || node.shot?.narrativeJob?.claim || node.card.dramaticFunction || node.card.direction,
    '需要继续说明：为什么这件事能证明这个优势，以及它如何服务目标机会。',
    148,
  );
}

function readableEffect(node: GraphNode | undefined): string {
  if (!node) return '还需要说明这个能力如何进入真实工作过程。';
  return compact(
    node.shot?.narrativeJob?.visualTranslation ||
      node.shot?.promptDraft ||
      node.shot?.action ||
      node.card.direction,
    '还需要说明这个能力如何进入真实工作过程。',
    148,
  );
}

function readableValue(node: GraphNode | undefined): string {
  if (!node) return '还需要落到对外部对象有用的结果。';
  return compact(
    node.shot?.narrativeJob?.intentSummary ||
      node.shot?.narrativeJob?.audience ||
      node.shot?.narrativeJob?.avoidMisread ||
      node.card.personalTrace,
    '还需要落到对外部对象有用的结果。',
    148,
  );
}

function relationsAround(node: GraphNode | undefined): CausalEdge[] {
  if (!node) return [];
  return CAUSAL_EDGES.filter((edge) => edge.from === node.stepKey || edge.to === node.stepKey);
}

function groupByStep(nodes: GraphNode[]): Record<CausalStepKey, GraphNode[]> {
  const grouped: Record<CausalStepKey, GraphNode[]> = {
    role: [],
    ability: [],
    cause: [],
    effect: [],
    proof: [],
    contact: [],
    value: [],
  };
  nodes.forEach((node) => grouped[node.stepKey].push(node));
  return grouped;
}

function relationSentence(edge: CausalEdge): string {
  const from = STEP_BY_KEY[edge.from].shortLabel;
  const to = STEP_BY_KEY[edge.to].shortLabel;
  return `${from} → ${to}`;
}

export default function StoryCardsGraph({ cards, storyShots, onRemoveCard }: StoryCardsGraphProps) {
  const nodes = useMemo(() => buildGraph(cards, storyShots), [cards, storyShots]);
  const groupedNodes = useMemo(() => groupByStep(nodes), [nodes]);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [selectedId, setSelectedId] = useState<string>(() => nodes[0]?.id ?? '');
  const [viewport, setViewport] = useState<ViewportState>({ scale: 1 });
  const selected = nodes.find((node) => node.id === selectedId) ?? nodes[0];
  const selectedRelations = relationsAround(selected);

  useEffect(() => {
    if (nodes.length > 0 && !nodes.some((node) => node.id === selectedId)) {
      setSelectedId(nodes[0].id);
    }
  }, [nodes, selectedId]);

  const zoomBy = useCallback((delta: number) => {
    setViewport((current) => ({
      scale: clamp(Number((current.scale + delta).toFixed(2)), 0.72, 1.35),
    }));
  }, []);

  const resetViewport = useCallback(() => {
    setViewport({ scale: 1 });
    canvasRef.current?.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-[10px]"
        style={{ borderColor: 'var(--panel-border)', background: 'var(--background)' }}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 font-mono font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5 text-nayin-bright" />
            Causal Chain
          </span>
          <span
            className="rounded-full border px-2 py-0.5 text-muted-foreground"
            style={{ borderColor: 'var(--panel-border)' }}
          >
            {CAUSAL_STEPS.length} 列
          </span>
          <span
            className="rounded-full border px-2 py-0.5 text-muted-foreground"
            style={{ borderColor: 'var(--panel-border)' }}
          >
            {CAUSAL_EDGES.length} 条关系
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => zoomBy(0.08)}
            className="flex h-6 w-6 items-center justify-center rounded-full border text-muted-foreground transition hover:text-foreground"
            style={{ borderColor: 'var(--panel-border)' }}
            aria-label="放大因果链图"
          >
            <ZoomIn className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => zoomBy(-0.08)}
            className="flex h-6 w-6 items-center justify-center rounded-full border text-muted-foreground transition hover:text-foreground"
            style={{ borderColor: 'var(--panel-border)' }}
            aria-label="缩小因果链图"
          >
            <ZoomOut className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={resetViewport}
            className="flex h-6 w-6 items-center justify-center rounded-full border text-muted-foreground transition hover:text-foreground"
            style={{ borderColor: 'var(--panel-border)' }}
            aria-label="重置因果链图"
          >
            <LocateFixed className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div
        ref={canvasRef}
        className="relative min-h-[390px] flex-1 overflow-auto rounded-lg border custom-scrollbar"
        style={{
          borderColor: 'var(--panel-border)',
          background: 'linear-gradient(145deg, var(--background), var(--panel-header))',
        }}
      >
        <div
          className="sticky left-2 top-2 z-[40] inline-flex rounded-full border bg-background/85 px-2 py-1 text-[10px] font-mono text-muted-foreground backdrop-blur"
          style={{ borderColor: 'var(--panel-border)' }}
        >
          {Math.round(viewport.scale * 100)}%
        </div>

        <div
          className="origin-top-left px-3 pb-4 pt-1"
          style={{
            transform: `scale(${viewport.scale})`,
            width: `${100 / viewport.scale}%`,
          }}
        >
          <div
            className="grid min-w-[1380px] items-stretch gap-2"
            style={{
              gridTemplateColumns:
                'minmax(142px,1fr) 74px minmax(142px,1fr) 74px minmax(142px,1fr) 74px minmax(142px,1fr) 74px minmax(142px,1fr) 74px minmax(142px,1fr) 74px minmax(142px,1fr)',
            }}
          >
            {CAUSAL_STEPS.map((step, index) => {
              const columnNodes = groupedNodes[step.key];
              const edge = CAUSAL_EDGES[index];

              return (
                <div key={step.key} className="contents">
                  <section
                    className="flex min-h-[330px] flex-col rounded-md border bg-background/78"
                    style={{ borderColor: 'var(--panel-border)' }}
                    aria-label={step.label}
                  >
                    <div
                      className="border-b px-2.5 py-2"
                      style={{ borderColor: 'var(--panel-border)', background: 'var(--panel-header)' }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold leading-tight text-foreground">
                          {step.label}
                        </span>
                        <span className="rounded-full border px-1.5 py-0.5 text-[8px] font-mono text-muted-foreground" style={{ borderColor: 'var(--panel-border)' }}>
                          {columnNodes.length}
                        </span>
                      </div>
                      <div className="mt-1 text-[9px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                        {step.location}
                      </div>
                    </div>

                    <div className="flex flex-1 flex-col gap-2 p-2">
                      {columnNodes.length > 0 ? (
                        columnNodes.map((node) => {
                          const isSelected = selected?.id === node.id;

                          return (
                            <div
                              key={node.id}
                              className={[
                                'group relative min-h-[102px] rounded-md border bg-background px-2 py-2 text-left shadow-sm transition',
                                isSelected
                                  ? 'ring-2 ring-[var(--nayin-accent)] ring-offset-2 ring-offset-background'
                                  : 'hover:-translate-y-0.5 hover:shadow-md',
                              ].join(' ')}
                              style={{ borderColor: isSelected ? 'var(--nayin-accent)' : 'var(--panel-border)' }}
                            >
                              <button
                                type="button"
                                onClick={() => setSelectedId(node.id)}
                                className="block h-full w-full rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]/35"
                                aria-pressed={isSelected}
                              >
                                <div className="flex items-start justify-between gap-1 pr-6">
                                  <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-semibold ${STATUS_CLASS[node.status]}`}>
                                    {STATUS_LABEL[node.status]}
                                  </span>
                                  <span className="shrink-0 text-[8px] font-mono text-muted-foreground">
                                    #{node.shotNo}
                                  </span>
                                </div>

                                <span className="mt-1.5 line-clamp-2 block text-[10px] font-semibold leading-snug text-foreground">
                                  {node.label}
                                </span>

                                <div className="mt-2 grid grid-cols-2 gap-1 text-[8px] leading-tight text-muted-foreground">
                                  <span className="rounded border px-1 py-0.5" style={{ borderColor: 'var(--panel-border)' }}>
                                    权重 {node.weight}/5
                                  </span>
                                  <span className="rounded border px-1 py-0.5" style={{ borderColor: 'var(--panel-border)' }}>
                                    {node.location}
                                  </span>
                                </div>
                              </button>
                              {onRemoveCard ? (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onRemoveCard(node.card.id);
                                  }}
                                  className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border bg-background/90 text-muted-foreground opacity-75 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
                                  style={{ borderColor: 'var(--panel-border)' }}
                                  aria-label={`删除卡片：${node.card.title || node.label}`}
                                  title="删除这张卡片"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              ) : null}
                            </div>
                          );
                        })
                      ) : (
                        <div
                          className="flex min-h-[86px] items-center justify-center rounded-md border border-dashed px-2 text-center text-[9px] leading-relaxed text-muted-foreground"
                          style={{ borderColor: 'var(--panel-border)' }}
                        >
                          等待材料
                        </div>
                      )}
                    </div>
                  </section>

                  {edge ? (
                    <div className="flex min-h-[330px] items-center justify-center">
                      <div className="relative flex w-full items-center">
                        <span className="h-px flex-1 bg-[var(--nayin-accent)]/35" />
                        <span className="h-2 w-2 rotate-45 border-r border-t border-[var(--nayin-accent)]/55" />
                        <div className="absolute left-1/2 top-1/2 flex w-[72px] -translate-x-1/2 -translate-y-[2.3rem] flex-col items-center gap-1 text-center">
                          <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-semibold ${RELATION_CLASS[edge.type]}`}>
                            {edge.type}
                          </span>
                          <span className="text-[8px] leading-tight text-muted-foreground">
                            {edge.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div
        className="rounded-lg border p-3"
        style={{ borderColor: 'var(--panel-border)', background: 'var(--background)' }}
      >
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
              <Tags className="h-3 w-3 text-nayin-bright" />
              {selected ? STEP_BY_KEY[selected.stepKey].label : '因果链'}
            </div>
            <h4 className="mt-1 text-sm font-semibold text-foreground">
              {selected?.card.title || selected?.label || '未选择卡片'}
            </h4>
          </div>

          {selected ? (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${STATUS_CLASS[selected.status]}`}>
                {STATUS_LABEL[selected.status]}
              </span>
              <span
                className="rounded-full border px-2 py-1 text-[10px] text-muted-foreground"
                style={{ borderColor: 'var(--panel-border)' }}
              >
                权重 {selected.weight}/5
              </span>
              <span
                className="rounded-full border px-2 py-1 text-[10px] text-muted-foreground"
                style={{ borderColor: 'var(--panel-border)' }}
              >
                {selected.location}
              </span>
              {onRemoveCard ? (
                <button
                  type="button"
                  onClick={() => onRemoveCard(selected.card.id)}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] text-muted-foreground transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
                  style={{ borderColor: 'var(--panel-border)' }}
                  aria-label={`删除卡片：${selected.card.title || selected.label}`}
                  title="删除这张卡片"
                >
                  <Trash2 className="h-3 w-3" />
                  删除
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="grid gap-2 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            <span className="font-semibold text-foreground">内容：</span>
            {compact(selected?.card.content || selected?.card.sourceQuote, '选择上方卡片查看具体内容。', 148)}
          </p>
          <p>
            <span className="font-semibold text-foreground">证据：</span>
            {readableEvidence(selected)}
          </p>
          <p>
            <span className="font-semibold text-foreground">因果解释：</span>
            {readableCause(selected)}
          </p>
          <p>
            <span className="font-semibold text-foreground">发生作用：</span>
            {readableEffect(selected)}
          </p>
          <p>
            <span className="font-semibold text-foreground">外部价值：</span>
            {readableValue(selected)}
          </p>

          {selectedRelations.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {selectedRelations.map((edge) => (
                <span
                  key={`${edge.from}-${edge.to}`}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-medium ${RELATION_CLASS[edge.type]}`}
                >
                  {edge.type}
                  <span className="font-normal opacity-75">{relationSentence(edge)}</span>
                  <span className="font-normal">{edge.label}</span>
                </span>
              ))}
            </div>
          ) : null}

          <p className="flex items-center gap-1.5 text-[10px]">
            <Sparkles className="h-3 w-3 text-nayin-bright" />
            {selected?.status === 'ready'
              ? '这张卡已经能进入镜头任务。'
              : '这张卡还需要补足证据、因果或对外价值。'}
          </p>
        </div>
      </div>
    </div>
  );
}
