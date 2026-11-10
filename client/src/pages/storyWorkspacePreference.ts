import { STORY_PANELS } from "@/features/analysis/storyPanels";
import type { StudioWorkspace } from "./editingStudioWorkspace";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
export type VideoView = "plan" | "editing";
const workspaceValues: readonly string[] = [
  "publishing",
  "images",
  "editing",
  ...STORY_PANELS.map(panel => panel.id),
];

function key(
  userId: number | null | undefined,
  storyId: number | null,
  part: string
) {
  return Number.isSafeInteger(userId) &&
    userId! > 0 &&
    Number.isSafeInteger(storyId) &&
    storyId! > 0
    ? `dt:story-view:${userId}:${storyId}:${part}`
    : null;
}

/** Preferences are device-local, scoped to an authenticated account and a saved story. */
export function readStoryView(
  storage: StorageLike | null,
  userId: number | null | undefined,
  storyId: number | null,
  part: "workspace"
): StudioWorkspace | null;
export function readStoryView(
  storage: StorageLike | null,
  userId: number | null | undefined,
  storyId: number | null,
  part: "video"
): VideoView | null;
export function readStoryView(
  storage: StorageLike | null,
  userId: number | null | undefined,
  storyId: number | null,
  part: "workspace" | "video"
): StudioWorkspace | VideoView | null {
  const storageKey = key(userId, storyId, part);
  if (!storageKey || !storage) return null;
  try {
    const value = storage.getItem(storageKey);
    return value &&
      (part === "workspace"
        ? workspaceValues.includes(value)
        : value === "plan" || value === "editing")
      ? (value as StudioWorkspace | VideoView)
      : null;
  } catch {
    return null;
  }
}

export function saveStoryView(
  storage: StorageLike | null,
  userId: number | null | undefined,
  storyId: number | null,
  part: "workspace",
  value: StudioWorkspace
): void;
export function saveStoryView(
  storage: StorageLike | null,
  userId: number | null | undefined,
  storyId: number | null,
  part: "video",
  value: VideoView
): void;
export function saveStoryView(
  storage: StorageLike | null,
  userId: number | null | undefined,
  storyId: number | null,
  part: "workspace" | "video",
  value: StudioWorkspace | VideoView
) {
  const storageKey = key(userId, storyId, part);
  if (!storageKey || !storage) return;
  try {
    storage.setItem(storageKey, value);
  } catch {
    /* Continue with the current view when storage is unavailable. */
  }
}

export function browserStoryViewStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
