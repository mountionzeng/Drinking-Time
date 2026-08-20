export type StoryboardMatrixEntry = {
  originalIndex: number;
  stableShotId: string;
};

export type StoryboardMatrixTiming = {
  stableShotId: string;
  startFrame: number;
  endFrame: number;
};

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
  targetWidth: number;
  unplacedWidth?: number;
}): {
  entries: Entry[];
  widths: number[];
  startOffsets: number[];
} {
  const timingByShotId = new Map(
    input.timings.map(timing => [timing.stableShotId, timing] as const)
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
  const timelineEndFrame = input.timings.reduce(
    (maximum, timing) => Math.max(maximum, timing.endFrame),
    0
  );
  const targetWidth = Math.max(1, input.targetWidth);
  const widths = placed.map((entry, index) => {
    const timing = timingByShotId.get(entry.stableShotId)!;
    const next = placed[index + 1];
    const nextStartFrame = next
      ? timingByShotId.get(next.stableShotId)!.startFrame
      : timelineEndFrame;
    const frameSpan = Math.max(1, nextStartFrame - timing.startFrame);
    return timelineEndFrame > 0
      ? (frameSpan / timelineEndFrame) * targetWidth
      : targetWidth / Math.max(1, placed.length);
  });
  widths.push(...unplaced.map(() => input.unplacedWidth ?? 72));

  let offset = 0;
  const startOffsets = widths.map(width => {
    const start = offset;
    offset += width;
    return start;
  });
  return { entries: [...placed, ...unplaced], widths, startOffsets };
}
