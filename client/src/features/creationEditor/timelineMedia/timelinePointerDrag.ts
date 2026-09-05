/** Pointer cancellation is rollback-only: never turn a cancelled gesture into a command. */
export function cancelTimelinePointerDrag<T extends { pointerId: number }>(
  current: T | null,
  pointerId: number
): T | null {
  return current?.pointerId === pointerId ? null : current;
}
