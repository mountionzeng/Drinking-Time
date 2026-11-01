import { create } from "zustand";

export type BookModuleActions = {
  scope: string;
  storyId: number;
  modules: { id: string; text: string }[];
  convert(id: string, kind: "image" | "music"): void;
  merge(ids: string[]): void;
};

// Commands belong to the mounted editor and use its existing undo/save flow.
export const useBookModuleActions = create<{
  session: BookModuleActions | null;
  setSession(session: BookModuleActions | null): void;
}>(set => ({ session: null, setSession: session => set({ session }) }));
