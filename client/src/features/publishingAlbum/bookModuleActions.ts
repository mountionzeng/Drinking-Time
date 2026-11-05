import { create } from "zustand";
import type { BookRewriteTarget } from '@shared/bookRewrite';
import type { LayoutModuleContext } from '@shared/layoutModuleContext';

export type BookModuleActions = {
  scope: string;
  storyId: number;
  chapterId?: number;
  modules: { id: string; text: string }[];
  convert(id: string, kind: "image" | "music"): void;
  merge(ids: string[]): void;
  composeImage?(instruction?: string, ids?: string[]): Promise<void>;
  resumeImageComposition?(task: import('@shared/bookModuleImageTask').BookModuleImageTask): Promise<void>;
  captureRewrite?(module: LayoutModuleContext): BookRewriteTarget | undefined;
  replaceRewrite?(target: BookRewriteTarget, text: string): void;
};

// Commands belong to the mounted editor and use its existing undo/save flow.
export const useBookModuleActions = create<{
  session: BookModuleActions | null;
  setSession(session: BookModuleActions | null): void;
}>(set => ({ session: null, setSession: session => set({ session }) }));
