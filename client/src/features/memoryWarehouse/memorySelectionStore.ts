import { useSyncExternalStore } from "react";
export type SelectedMemory = { id: string; title: string };
const empty: SelectedMemory[] = [];
const selections = new Map<string, SelectedMemory[]>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const memorySelectionKey = (
  accountId: number | null,
  storyId: number | null
) => `${accountId ?? "guest"}:${storyId ?? "none"}`;
export const getMemorySelection = (key: string) => selections.get(key) ?? empty;
export function setMemorySelection(
  key: string,
  next: SelectedMemory[] | ((previous: SelectedMemory[]) => SelectedMemory[])
) {
  selections.set(
    key,
    typeof next === "function" ? next(getMemorySelection(key)) : next
  );
  listeners.forEach(listener => listener());
}
export function useMemorySelection(key: string) {
  const selected = useSyncExternalStore(
    subscribe,
    () => getMemorySelection(key),
    () => empty
  );
  return [
    selected,
    (
      next:
        | SelectedMemory[]
        | ((previous: SelectedMemory[]) => SelectedMemory[])
    ) => setMemorySelection(key, next),
  ] as const;
}
