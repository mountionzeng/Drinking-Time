/**
 * 唯一的「哪一个视觉素材在这一帧胜出」排序规则。
 *
 * 之前预览、剪辑行和导出各自写了一份排序：`timelineLayout.compareRows` 认
 * visualLayer，`storyboardTiming.storyboardTimingWinnerAt` 不认。只要用户移动过
 * 底层视频（移动会把 stackOrder 抬到最高），预览就会让底层盖住上层，而导出仍然
 * 按图层出片——同一份数据两个答案。这个模块把规则收敛成一处，谁要判赢家都必须
 * 走这里。
 */
export type VisualPriority = {
  /** 锚定素材永远优先，压过任何图层。 */
  anchored: boolean;
  /** 越大越靠上。 */
  visualLayer: number;
  /**
   * 同层素材种类的显式优先级。普通镜头和 overlay 为 0；用户明确放置的一帧
   * 图片为 1，因此保留「同层图片在视频之上」的既有交互语义。
   */
  sourceKindOrder?: number;
  /** 同层内越大越新移动过。 */
  stackOrder: number;
  /** 同层同优先级时位置小的在上。 */
  position: number;
  /** 最后的稳定 tie-break，保证客户端预览与服务端导出不可能给出不同答案。 */
  tieId: string;
};

export function normalizeVisualLayer(value: number | null | undefined): number {
  return Math.max(0, Math.round(value ?? 0));
}

/** 正数表示 left 胜出。 */
export function compareVisualPriority(
  left: VisualPriority,
  right: VisualPriority
): number {
  if (left.anchored !== right.anchored) return left.anchored ? 1 : -1;
  const leftLayer = normalizeVisualLayer(left.visualLayer);
  const rightLayer = normalizeVisualLayer(right.visualLayer);
  if (leftLayer !== rightLayer) return leftLayer - rightLayer;
  const leftSourceKind = left.sourceKindOrder ?? 0;
  const rightSourceKind = right.sourceKindOrder ?? 0;
  if (leftSourceKind !== rightSourceKind) {
    return leftSourceKind - rightSourceKind;
  }
  if (left.stackOrder !== right.stackOrder) {
    return left.stackOrder - right.stackOrder;
  }
  if (left.position !== right.position) return right.position - left.position;
  return right.tieId.localeCompare(left.tieId);
}

/** 候选里胜出的那一个；没有候选返回 null。 */
export function pickVisualWinner<T>(
  candidates: readonly T[],
  priorityOf: (candidate: T) => VisualPriority
): T | null {
  let winner: T | null = null;
  let winnerPriority: VisualPriority | null = null;
  for (const candidate of candidates) {
    const priority = priorityOf(candidate);
    if (
      winnerPriority === null ||
      compareVisualPriority(priority, winnerPriority) > 0
    ) {
      winner = candidate;
      winnerPriority = priority;
    }
  }
  return winner;
}

/** 隐藏图层集合：解析可见素材前统一过一遍。 */
export function hiddenVisualLayerSet(
  hidden: readonly number[] | null | undefined
): ReadonlySet<number> {
  return new Set((hidden ?? []).map(normalizeVisualLayer));
}
