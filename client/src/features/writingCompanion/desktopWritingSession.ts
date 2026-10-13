import { create } from "zustand";
import type { WritingCompanionSnapshot } from "./writingCompanionText";

export type DesktopWritingSession = {
  id: string;
  storyId: number;
  accountId: number | null;
  epoch: number;
  snapshot: WritingCompanionSnapshot;
  getSnapshot: () => WritingCompanionSnapshot;
};
export const useDesktopWritingSession = create<{
  session: DesktopWritingSession | null;
  setSession: (session: DesktopWritingSession | null) => void;
}>(set => ({ session: null, setSession: session => set({ session }) }));
