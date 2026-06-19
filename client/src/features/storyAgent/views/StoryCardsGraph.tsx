import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  GitBranch,
  LocateFixed,
  Move3D,
  Network,
  Sparkles,
  Tags,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { StoryCard, StoryShot } from '@/features/storyAgent/types';
import { useStorySpine } from '@/features/storyAgent/spine/storySpine';

type GraphNode = {
  id: string;
  label: string;
  subtitle: string;
  status: 'ready' | 'ask' | 'evidence' | 'cause' | 'hold';
  chain: string;
  x: number;
  y: number;
  z: number;
  shotNo?: number;
  card?: StoryCard;
  shot?: StoryShot;
};

type GraphEdge = {
  id: string;
  from: string;
  to: string;
  strength: 'strong' | 'normal' | 'soft';
};

type StoryCardsGraphProps = {
  cards: StoryCard[];
  storyShots: StoryShot[];
};

type ClusterMode = 'free' | 'chain' | 'status';

type NodePosition = {
  x: number;
  y: number;
  z: number;
};

type ViewportState = {
  x: number;
  y: number;
  scale: number;
};

type DragState =
  | {
      type: 'node';
      id: string;
      startClientX: number;
      startClientY: number;
      startX: number;
      startY: number;
      rectWidth: number;
      rectHeight: number;
      scale: number;
    }
  | {
      type: 'pan';
      startClientX: number;
      startClientY: number;
      startX: number;
      startY: number;
    };

const CHAIN_STEPS = [
  '岗位关心什么',
  '你有什么能力',
  '为什么有这个能力',
  '怎么发生作用',
  '凭什么相信',
  '为什么值得联系',
  '外部价值',
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

const STATUS_ORDER: GraphNode['status'][] = ['ready', 'ask', 'evidence', 'cause', 'hold'];

const CLUSTER_LABEL: Record<ClusterMode, string> = {
  free: '自由图谱',
  chain: '按说服链聚类',
  status: '按建议状态聚类',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function compact(text: string | undefined, fallback: string, length = 62): string {
  const value = text?.replace(/\s+/g, ' ').trim() || fallback;
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function statusFor(card: StoryCard, shot: StoryShot | undefined, index: number): GraphNode['status'] {
  const text = `${card.title} ${card.content} ${shot?.narrativeJob?.evidence ?? ''} ${shot?.rationale ?? ''}`;
  if (shot?.narrativeJob?.visualTranslation || shot?.promptDraft || shot?.promptRun?.finalPrompt) return 'ready';
  if (/案例|作品|证据|反馈|结果|证明/.test(text)) return 'evidence';
  if (/因为|所以|判断|取舍|为什么|因果/.test(text)) return 'cause';
  return index <= 1 ? 'ask' : 'hold';
}

function chainFor(index: number, card: StoryCard, shot: StoryShot | undefined): string {
  const text = `${card.title} ${card.content} ${shot?.narrativeJob?.claim ?? ''} ${shot?.narrativeJob?.evidence ?? ''}`;
  if (/岗位|机会|招聘|合伙|需要|关心/.test(text)) return CHAIN_STEPS[0];
  if (/能力|优势|擅长|可以|会/.test(text)) return CHAIN_STEPS[1];
  if (/因为|来源|经历|背景/.test(text)) return CHAIN_STEPS[2];
  if (/作用|取舍|判断|执行|流程/.test(text)) return CHAIN_STEPS[3];
  if (/证据|作品|案例|反馈|相信|结果/.test(text)) return CHAIN_STEPS[4];
  if (/联系|合作|值得|面试/.test(text)) return CHAIN_STEPS[5];
  if (/价值|带来|产品|外部|影响/.test(text)) return CHAIN_STEPS[6];
  return CHAIN_STEPS[Math.min(index + 1, CHAIN_STEPS.length - 1)];
}

function buildGraph(cards: StoryCard[], storyShots: StoryShot[]) {
  const nodes: GraphNode[] = [
    {
      id: 'root',
      label: '求职故事主线',
      subtitle: '把经历组织成可信的机会判断',
      status: 'ready',
      chain: '主线',
      x: 50,
      y: 50,
      z: 52,
    },
  ];
  const edges: GraphEdge[] = [];

  CHAIN_STEPS.forEach((label, index) => {
    const x = 12 + index * 12.6;
    const y = index % 2 === 0 ? 17 : 25;
    const id = `chain-${index}`;
    nodes.push({
      id,
      label,
      subtitle: index === 0 ? '目标约束' : '说服链节点',
      status: 'hold',
      chain: label,
      x,
      y,
      z: 14 + index * 2,
    });
    edges.push({
      id: `root-${id}`,
      from: 'root',
      to: id,
      strength: index === 1 || index === 4 ? 'normal' : 'soft',
    });
    if (index > 0) {
      edges.push({
        id: `chain-${index - 1}-${index}`,
        from: `chain-${index - 1}`,
        to: id,
        strength: 'soft',
      });
    }
  });

  cards.forEach((card, index) => {
    const shot = storyShots[index];
    const ring = Math.max(1, cards.length);
    const angle = (Math.PI * 2 * index) / ring - Math.PI / 2;
    const radiusX = 32 + Math.min(12, cards.length * 1.5);
    const radiusY = 26 + Math.min(10, cards.length);
    const x = 50 + Math.cos(angle) * radiusX;
    const y = 54 + Math.sin(angle) * radiusY;
    const z = 20 + ((index * 17) % 38);
    const chain = chainFor(index, card, shot);
    const status = statusFor(card, shot, index);
    const id = `card-${card.id}`;
    const chainIndex = Math.max(0, CHAIN_STEPS.indexOf(chain));

    nodes.push({
      id,
      label: compact(card.title, `优势卡 ${index + 1}`, 22),
      subtitle: compact(card.content || card.sourceQuote, card.emotion || '待解释', 34),
      status,
      chain,
      x: Math.min(88, Math.max(12, x)),
      y: Math.min(86, Math.max(30, y)),
      z,
      shotNo: index + 1,
      card,
      shot,
    });
    edges.push({
      id: `root-${id}`,
      from: 'root',
      to: id,
      strength: status === 'ready' ? 'strong' : 'normal',
    });
    edges.push({
      id: `chain-${chainIndex}-${id}`,
      from: `chain-${chainIndex}`,
      to: id,
      strength: 'normal',
    });
    if (index > 0) {
      edges.push({
        id: `card-${cards[index - 1].id}-${card.id}`,
        from: `card-${cards[index - 1].id}`,
        to: id,
        strength: 'soft',
      });
    }
  });

  return { nodes, edges };
}

function basePositions(nodes: GraphNode[]): Record<string, NodePosition> {
  return Object.fromEntries(
    nodes.map((node) => [
      node.id,
      {
        x: node.x,
        y: node.y,
        z: node.z,
      },
    ]),
  );
}

function clusteredPositions(nodes: GraphNode[], mode: ClusterMode): Record<string, NodePosition> {
  if (mode === 'free') return basePositions(nodes);

  const positions: Record<string, NodePosition> = {};
  const cardNodes = nodes.filter((node) => node.card);

  nodes.forEach((node) => {
    if (node.id === 'root') {
      positions[node.id] = { x: 50, y: 50, z: 60 };
      return;
    }

    if (node.id.startsWith('chain-')) {
      const index = Number(node.id.replace('chain-', ''));
      positions[node.id] = {
        x: 11 + index * 13,
        y: mode === 'chain' ? 18 : 13,
        z: 16 + index,
      };
    }
  });

  if (mode === 'chain') {
    CHAIN_STEPS.forEach((chain, chainIndex) => {
      const group = cardNodes.filter((node) => node.chain === chain);
      const fallback = cardNodes.filter((node, index) => group.length === 0 && index % CHAIN_STEPS.length === chainIndex);
      const nodesInGroup = group.length > 0 ? group : fallback;
      nodesInGroup.forEach((node, index) => {
        const offset = index - (nodesInGroup.length - 1) / 2;
        positions[node.id] = {
          x: clamp(11 + chainIndex * 13 + offset * 2.8, 7, 93),
          y: clamp(52 + offset * 15, 30, 86),
          z: node.z + 18,
        };
      });
    });
    return positions;
  }

  const presentStatuses = STATUS_ORDER.filter((status) => cardNodes.some((node) => node.status === status));

  presentStatuses.forEach((status, statusIndex) => {
    const group = cardNodes.filter((node) => node.status === status);
    group.forEach((node, index) => {
      const columns = Math.min(3, Math.ceil(Math.sqrt(group.length)));
      const rows = Math.ceil(group.length / columns);
      const column = index % columns;
      const row = Math.floor(index / columns);
      const statusCenterX =
        presentStatuses.length === 1
          ? 50
          : 14 + statusIndex * (72 / Math.max(1, presentStatuses.length - 1));
      positions[node.id] = {
        x: clamp(statusCenterX + (column - (columns - 1) / 2) * 19, 10, 90),
        y: clamp(50 + (row - (rows - 1) / 2) * 18, 24, 86),
        z: node.z + 14,
      };
    });
  });

  return positions;
}

function mergePositions(nodes: GraphNode[], previous: Record<string, NodePosition>): Record<string, NodePosition> {
  const next: Record<string, NodePosition> = {};
  nodes.forEach((node) => {
    next[node.id] = previous[node.id] ?? { x: node.x, y: node.y, z: node.z };
  });
  return next;
}

function edgePoints(edge: GraphEdge, nodeMap: Map<string, GraphNode>) {
  const from = nodeMap.get(edge.from);
  const to = nodeMap.get(edge.to);
  if (!from || !to) return null;
  return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
}

function readableEvidence(node: GraphNode): string {
  return compact(
    node.shot?.narrativeJob?.evidence || node.card?.sourceQuote || node.card?.rawText || node.card?.content,
    '还缺一条可以让陌生人相信的真实证据。',
    116,
  );
}

function readableCause(node: GraphNode): string {
  return compact(
    node.shot?.rationale || node.shot?.narrativeJob?.claim || node.card?.dramaticFunction || node.card?.direction,
    '需要继续说明：为什么这件事能证明这个优势，以及它如何服务目标机会。',
    116,
  );
}

export default function StoryCardsGraph({ cards, storyShots }: StoryCardsGraphProps) {
  const graph = useMemo(() => buildGraph(cards, storyShots), [cards, storyShots]);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const setPreferredDrawShotNo = useStorySpine((state) => state.setPreferredDrawShotNo);
  const [selectedId, setSelectedId] = useState<string>(() => graph.nodes.find((node) => node.card)?.id ?? 'root');
  const [clusterMode, setClusterMode] = useState<ClusterMode>('free');
  const [positions, setPositions] = useState<Record<string, NodePosition>>(() => basePositions(graph.nodes));
  const [viewport, setViewport] = useState<ViewportState>({ x: 0, y: 0, scale: 1 });
  const [dragState, setDragState] = useState<DragState | null>(null);
  const positionedNodes = useMemo(
    () =>
      graph.nodes.map((node) => ({
        ...node,
        ...(positions[node.id] ?? { x: node.x, y: node.y, z: node.z }),
      })),
    [graph.nodes, positions],
  );
  const nodeMap = useMemo(() => new Map(positionedNodes.map((node) => [node.id, node])), [positionedNodes]);
  const selected = nodeMap.get(selectedId) ?? graph.nodes.find((node) => node.card) ?? graph.nodes[0];
  const selectedDrawShotNo = selected.card ? selected.shotNo ?? null : null;

  useEffect(() => {
    setPositions((previous) => mergePositions(graph.nodes, previous));
  }, [graph.nodes]);

  useEffect(() => {
    if (!nodeMap.has(selectedId)) {
      setSelectedId(graph.nodes.find((node) => node.card)?.id ?? 'root');
    }
  }, [graph.nodes, nodeMap, selectedId]);

  useEffect(() => {
    if (selectedDrawShotNo != null) {
      setPreferredDrawShotNo(selectedDrawShotNo);
    }
  }, [selected.id, selectedDrawShotNo, setPreferredDrawShotNo]);

  const applyCluster = useCallback((mode: ClusterMode) => {
    setClusterMode(mode);
    setPositions(clusteredPositions(graph.nodes, mode));
  }, [graph.nodes]);

  const resetViewport = useCallback(() => {
    setViewport({ x: 0, y: 0, scale: 1 });
  }, []);

  const zoomBy = useCallback((delta: number) => {
    setViewport((current) => ({
      ...current,
      scale: clamp(Number((current.scale + delta).toFixed(2)), 0.55, 1.85),
    }));
  }, []);

  const startNodeDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>, node: GraphNode) => {
    if (event.button !== 0) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(node.id);
    setDragState({
      type: 'node',
      id: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: node.x,
      startY: node.y,
      rectWidth: rect.width,
      rectHeight: rect.height,
      scale: viewport.scale,
    });
  }, [viewport.scale]);

  const startPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({
      type: 'pan',
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: viewport.x,
      startY: viewport.y,
    });
  }, [viewport.x, viewport.y]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState) return;
    event.preventDefault();
    if (dragState.type === 'pan') {
      setViewport((current) => ({
        ...current,
        x: dragState.startX + event.clientX - dragState.startClientX,
        y: dragState.startY + event.clientY - dragState.startClientY,
      }));
      return;
    }

    const dx = ((event.clientX - dragState.startClientX) / (dragState.rectWidth * dragState.scale)) * 100;
    const dy = ((event.clientY - dragState.startClientY) / (dragState.rectHeight * dragState.scale)) * 100;
    setPositions((current) => ({
      ...current,
      [dragState.id]: {
        ...(current[dragState.id] ?? { x: dragState.startX, y: dragState.startY, z: 0 }),
        x: clamp(dragState.startX + dx, 5, 95),
        y: clamp(dragState.startY + dy, 8, 92),
      },
    }));
  }, [dragState]);

  const stopDrag = useCallback(() => {
    setDragState(null);
  }, []);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const nextScale = clamp(viewport.scale * (event.deltaY > 0 ? 0.9 : 1.1), 0.55, 1.85);
    setViewport((current) => ({
      ...current,
      scale: Number(nextScale.toFixed(2)),
    }));
  }, [viewport.scale]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-[10px]" style={{ borderColor: 'var(--panel-border)', background: 'var(--background)' }}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 font-mono font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <Move3D className="h-3.5 w-3.5 text-nayin-bright" />
            Advantage Graph
          </span>
          <span className="rounded-full border px-2 py-0.5 text-muted-foreground" style={{ borderColor: 'var(--panel-border)' }}>
            {CLUSTER_LABEL[clusterMode]}
          </span>
          <span className="text-muted-foreground">
            拖节点 · 拖空白平移 · 滚轮缩放
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => applyCluster('free')}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-1 transition hover:text-foreground"
            style={{
              borderColor: 'var(--panel-border)',
              background: clusterMode === 'free' ? 'var(--nayin-glow)' : 'transparent',
              color: clusterMode === 'free' ? 'var(--nayin-accent-bright)' : 'var(--muted-foreground)',
            }}
          >
            <Network className="h-3 w-3" />
            自由
          </button>
          <button
            type="button"
            onClick={() => applyCluster('chain')}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-1 transition hover:text-foreground"
            style={{
              borderColor: 'var(--panel-border)',
              background: clusterMode === 'chain' ? 'var(--nayin-glow)' : 'transparent',
              color: clusterMode === 'chain' ? 'var(--nayin-accent-bright)' : 'var(--muted-foreground)',
            }}
          >
            <GitBranch className="h-3 w-3" />
            链条聚类
          </button>
          <button
            type="button"
            onClick={() => applyCluster('status')}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-1 transition hover:text-foreground"
            style={{
              borderColor: 'var(--panel-border)',
              background: clusterMode === 'status' ? 'var(--nayin-glow)' : 'transparent',
              color: clusterMode === 'status' ? 'var(--nayin-accent-bright)' : 'var(--muted-foreground)',
            }}
          >
            <Tags className="h-3 w-3" />
            状态聚类
          </button>
          <button
            type="button"
            onClick={() => zoomBy(0.12)}
            className="flex h-6 w-6 items-center justify-center rounded-full border text-muted-foreground transition hover:text-foreground"
            style={{ borderColor: 'var(--panel-border)' }}
            aria-label="放大图谱"
          >
            <ZoomIn className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => zoomBy(-0.12)}
            className="flex h-6 w-6 items-center justify-center rounded-full border text-muted-foreground transition hover:text-foreground"
            style={{ borderColor: 'var(--panel-border)' }}
            aria-label="缩小图谱"
          >
            <ZoomOut className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={resetViewport}
            className="flex h-6 w-6 items-center justify-center rounded-full border text-muted-foreground transition hover:text-foreground"
            style={{ borderColor: 'var(--panel-border)' }}
            aria-label="重置图谱视图"
          >
            <LocateFixed className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div
        ref={canvasRef}
        className="relative min-h-[430px] flex-1 overflow-hidden rounded-lg border"
        style={{
          borderColor: 'var(--panel-border)',
          background:
            'radial-gradient(circle at 50% 50%, var(--nayin-glow), transparent 42%), linear-gradient(145deg, var(--background), var(--panel-header))',
          perspective: '900px',
          cursor: dragState?.type === 'pan' ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
        onPointerDown={startPan}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onWheel={handleWheel}
      >
        <div className="pointer-events-none absolute left-2 top-2 z-[300] rounded-full border bg-background/80 px-2 py-1 text-[10px] font-mono text-muted-foreground" style={{ borderColor: 'var(--panel-border)' }}>
          {Math.round(viewport.scale * 100)}%
        </div>

        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
            transformOrigin: '50% 50%',
          }}
        >
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {graph.edges.map((edge) => {
              const points = edgePoints(edge, nodeMap);
              if (!points) return null;
              const opacity = edge.strength === 'strong' ? 0.48 : edge.strength === 'normal' ? 0.3 : 0.16;
              const width = edge.strength === 'strong' ? 0.42 : 0.26;
              return (
                <line
                  key={edge.id}
                  x1={points.x1}
                  y1={points.y1}
                  x2={points.x2}
                  y2={points.y2}
                  stroke="var(--nayin-accent)"
                  strokeWidth={width}
                  strokeOpacity={opacity}
                />
              );
            })}
          </svg>

          <div className="absolute inset-0" style={{ transformStyle: 'preserve-3d', transform: 'rotateX(8deg) rotateZ(-1deg)' }}>
          {positionedNodes.map((node) => {
            const isSelected = node.id === selected.id;
            const isRoot = node.id === 'root';
            const isChain = node.id.startsWith('chain-');
            const scale = isRoot ? 1.08 : isChain ? 0.74 : 0.9 + node.z / 180;
            return (
              <button
                key={node.id}
                type="button"
                onPointerDown={(event) => startNodeDrag(event, node)}
                onClick={() => setSelectedId(node.id)}
                className={[
                  'absolute rounded-lg border text-left shadow-sm transition-all duration-200',
                  isRoot ? 'w-[172px] px-3 py-2.5' : isChain ? 'w-[94px] px-2 py-1.5' : 'w-[150px] px-2 py-1.5',
                  isSelected ? 'ring-2 ring-[var(--nayin-accent)] ring-offset-2 ring-offset-background' : 'hover:-translate-y-0.5 hover:shadow-md',
                  isRoot ? 'border-[var(--nayin-accent)] bg-[var(--nayin-accent)] text-background' : 'bg-background/92',
                ].join(' ')}
                style={{
                  left: `${node.x}%`,
                  top: `${node.y}%`,
                  transform: `translate(-50%, -50%) translateZ(${node.z}px) scale(${scale})`,
                  zIndex: Math.round(node.z) + (isSelected ? 100 : 0),
                  borderColor: isRoot ? 'var(--nayin-accent)' : 'var(--panel-border)',
                  cursor: dragState?.type === 'node' && dragState.id === node.id ? 'grabbing' : 'grab',
                }}
                aria-pressed={isSelected}
              >
                {!isRoot && !isChain ? (
                  <span className={`mb-1 inline-flex rounded-full border px-1.5 py-0.5 text-[8px] font-semibold ${STATUS_CLASS[node.status]}`}>
                    {STATUS_LABEL[node.status]}
                  </span>
                ) : null}
                <span className={isRoot ? 'block text-[11px] font-semibold' : isChain ? 'block text-[10px] font-medium leading-tight' : 'block text-[10px] font-semibold leading-tight text-foreground'}>
                  {node.label}
                </span>
                {!isChain ? (
                  <span className={isRoot ? 'mt-1 block text-[9px] opacity-80' : 'mt-1 line-clamp-1 block text-[8px] leading-relaxed text-muted-foreground'}>
                    {node.subtitle}
                  </span>
                ) : null}
              </button>
            );
          })}
          </div>
        </div>
      </div>

      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--panel-border)', background: 'var(--background)' }}>
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
              <GitBranch className="h-3 w-3 text-nayin-bright" />
              {selected.chain}
            </div>
            <h4 className="mt-1 text-sm font-semibold text-foreground">{selected.label}</h4>
          </div>
          <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold ${STATUS_CLASS[selected.status]}`}>
            {STATUS_LABEL[selected.status]}
          </span>
        </div>

        <div className="grid gap-2 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            <span className="font-semibold text-foreground">优势：</span>
            {compact(selected.card?.title || selected.shot?.narrativeJob?.claim, selected.subtitle, 96)}
          </p>
          <p>
            <span className="font-semibold text-foreground">证据：</span>
            {readableEvidence(selected)}
          </p>
          <p>
            <span className="font-semibold text-foreground">因果解释：</span>
            {readableCause(selected)}
          </p>
          <p className="flex items-center gap-1.5 text-[10px]">
            <Sparkles className="h-3 w-3 text-nayin-bright" />
            {selected.status === 'ready'
              ? '这类节点可以进入“把这一刻画出来”：先转成镜头任务，再生成提示词。'
              : '这类节点先继续追问，补足证据或因果后再成片。'}
          </p>
        </div>
      </div>
    </div>
  );
}
