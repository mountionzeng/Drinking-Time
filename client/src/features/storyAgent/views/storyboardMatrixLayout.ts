export type StoryboardMatrixEntry = {
  originalIndex: number;
  stableShotId: string;
};

export type StoryboardMatrixTiming = {
  stableShotId: string;
  startFrame: number;
  endFrame: number;
};

export type StoryboardMatrixTimingPreviewState = {
  gestureId: symbol;
  timing: StoryboardMatrixTiming;
};

export function updateStoryboardMatrixTimingPreview(
  current: StoryboardMatrixTimingPreviewState | null,
  timing: StoryboardMatrixTiming | null,
  gestureId: symbol
): StoryboardMatrixTimingPreviewState | null {
  if (timing) {
    return { gestureId, timing };
  }
  return current?.gestureId === gestureId ? null : current;
}

export function shouldCompactStoryboardMatrixForShot(
  alignedWidth: number,
  expandedWidth: number
): boolean {
  return alignedWidth < expandedWidth * 0.6;
}

export function buildStoryboardMatrixLayout<
  Entry extends StoryboardMatrixEntry,
>(input: {
  entries: readonly Entry[];
  timings: readonly StoryboardMatrixTiming[];
  /** 拖动中的单镜位置，只影响这次排版，不写回真实 timing。 */
  previewTiming?: StoryboardMatrixTiming | null;
  pixelsPerFrame: number;
  targetWidth: number;
  unplacedWidth?: number;
}): {
  entries: Entry[];
  leadingWidth: number;
  widths: number[];
  startOffsets: number[];
} {
  const timings = input.previewTiming
    ? input.timings.map(timing =>
        timing.stableShotId === input.previewTiming?.stableShotId
          ? input.previewTiming
          : timing
      )
    : input.timings;
  const timingByShotId = new Map(
    timings.map(timing => [timing.stableShotId, timing] as const)
  );
  const placed = input.entries
    .filter(entry => timingByShotId.has(entry.stableShotId))
    .sort((left, right) => {
      const leftTiming = timingByShotId.get(left.stableShotId)!;
      const rightTiming = timingByShotId.get(right.stableShotId)!;
      return (
        leftTiming.startFrame - rightTiming.startFrame ||
        left.originalIndex - right.originalIndex
      );
    });
  const unplaced = input.entries
    .filter(entry => !timingByShotId.has(entry.stableShotId))
    .sort((left, right) => left.originalIndex - right.originalIndex);
  const pixelsPerFrame = Math.max(Number.EPSILON, input.pixelsPerFrame);
  const targetWidth = Math.max(1, input.targetWidth);
  const firstPlacedTiming = placed[0]
    ? timingByShotId.get(placed[0].stableShotId)
    : undefined;
  const frameStartToPx = (frame: number) => Math.max(0, frame) * pixelsPerFrame;
  const leadingWidth = firstPlacedTiming
    ? frameStartToPx(firstPlacedTiming.startFrame)
    : 0;
  const widths = placed.map((entry, index) => {
    const timing = timingByShotId.get(entry.stableShotId)!;
    const next = placed[index + 1];
    const startPx = frameStartToPx(timing.startFrame);
    return next
      ? Math.max(
          pixelsPerFrame,
          frameStartToPx(timingByShotId.get(next.stableShotId)!.startFrame) -
            startPx
        )
      : Math.max(pixelsPerFrame, targetWidth - startPx);
  });
  widths.push(...unplaced.map(() => input.unplacedWidth ?? 72));

  const placedStartOffsets = placed.map(entry =>
    frameStartToPx(timingByShotId.get(entry.stableShotId)!.startFrame)
  );
  let unplacedOffset = placed.length
    ? placedStartOffsets[placed.length - 1] + widths[placed.length - 1]
    : 0;
  const unplacedStartOffsets = unplaced.map((_, index) => {
    const start = unplacedOffset;
    unplacedOffset += widths[placed.length + index];
    return start;
  });
  const startOffsets = [...placedStartOffsets, ...unplacedStartOffsets];
  return {
    entries: [...placed, ...unplaced],
    leadingWidth,
    widths,
    startOffsets,
  };
}
