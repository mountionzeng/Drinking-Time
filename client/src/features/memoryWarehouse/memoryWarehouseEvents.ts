import type { MemoryCardInput } from "@shared/memoryWarehouse";

export const OPEN_MEMORY_WAREHOUSE = "dt:open-memory-warehouse";
export const SAVE_MEMORY_CARD = "dt:save-memory-card";
export type MemoryCardSeed = Pick<
  MemoryCardInput,
  "content" | "origin" | "sourceStoryId"
>;
export function requestMemoryCard(seed: MemoryCardSeed) {
  window.dispatchEvent(new CustomEvent(SAVE_MEMORY_CARD, { detail: seed }));
}
