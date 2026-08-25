import {
  cloneVisualObjectClipboardSnapshot,
  type VisualObjectClipboardSnapshot,
} from "@shared/visualObjectClipboard";

export type VisualObjectClipboardSession = {
  write(snapshot: VisualObjectClipboardSnapshot): boolean;
  read(): VisualObjectClipboardSnapshot | null;
  dispose(): void;
};

/** In-memory, Story/session-scoped clipboard. Refreshing creates an empty one. */
export function createVisualObjectClipboardSession(input: {
  storyId: number;
}): VisualObjectClipboardSession {
  const storyId = input.storyId;
  let disposed = false;
  let value: VisualObjectClipboardSnapshot | null = null;

  return {
    write(snapshot) {
      if (disposed || snapshot.sourceStoryId !== storyId) return false;
      value = cloneVisualObjectClipboardSnapshot(snapshot);
      return true;
    },
    read() {
      return disposed || !value
        ? null
        : cloneVisualObjectClipboardSnapshot(value);
    },
    dispose() {
      disposed = true;
      value = null;
    },
  };
}
