import {
  cloneVisualObjectClipboardSnapshot,
  type VisualObjectClipboardSnapshot,
} from "@shared/visualObjectClipboard";

export type VisualObjectClipboardSession = {
  write(snapshot: VisualObjectClipboardSnapshot): boolean;
  read(): VisualObjectClipboardSnapshot | null;
  updateContext(input: { storyId: number; editorSessionEpoch: string }): void;
  clear(): void;
  dispose(): void;
};

/** In-memory, Story/session-scoped clipboard. Refreshing creates an empty one. */
export function createVisualObjectClipboardSession(input: {
  storyId: number;
  editorSessionEpoch: string;
}): VisualObjectClipboardSession {
  let storyId = input.storyId;
  let editorSessionEpoch = input.editorSessionEpoch;
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
    updateContext(next) {
      if (
        next.storyId !== storyId ||
        next.editorSessionEpoch !== editorSessionEpoch
      ) {
        value = null;
      }
      storyId = next.storyId;
      editorSessionEpoch = next.editorSessionEpoch;
    },
    clear() {
      value = null;
    },
    dispose() {
      disposed = true;
      value = null;
    },
  };
}
