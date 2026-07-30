export const MAX_CONCURRENT_STORYBOARD_RENDERS = 2;

export function addShotToRenderSlots(
  activeShotNos: readonly number[],
  shotNo: number
): number[] {
  return activeShotNos.includes(shotNo)
    ? [...activeShotNos]
    : [...activeShotNos, shotNo];
}

export function removeShotFromRenderSlots(
  activeShotNos: readonly number[],
  shotNo: number
): number[] {
  return activeShotNos.filter(activeShotNo => activeShotNo !== shotNo);
}

export function mergeActiveRenderShotNos(
  ...groups: ReadonlyArray<readonly number[]>
): number[] {
  return Array.from(new Set(groups.flat()));
}

export function canStartShotRender(input: {
  shotNo: number;
  activeShotNos: readonly number[];
  maxConcurrent?: number;
}): boolean {
  if (input.activeShotNos.includes(input.shotNo)) return false;
  return (
    input.activeShotNos.length <
    (input.maxConcurrent ?? MAX_CONCURRENT_STORYBOARD_RENDERS)
  );
}
