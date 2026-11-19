/** Synchronous read of the visible warehouse selection; never changes the video selection. */
export const READ_WAREHOUSE_CHAT_SELECTION = "dt:read-warehouse-chat-selection";
export type WarehouseChatSelectionRequest = {
  storyId: number;
  selection: { stableShotId: string; imageIds: number[] } | null;
};
export function readWarehouseChatSelection(storyId: number) {
  const detail: WarehouseChatSelectionRequest = { storyId, selection: null };
  window.dispatchEvent(new CustomEvent(READ_WAREHOUSE_CHAT_SELECTION, { detail }));
  return detail.selection;
}
