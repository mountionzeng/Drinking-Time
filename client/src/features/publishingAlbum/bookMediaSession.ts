import { create } from "zustand";
export type BookMediaSession = {
  key: string;
  accountId: number | null;
  epoch: number;
  storyId: number;
  chapterId: number;
  moduleId: string;
  shotNo?: number;
  imageUrl: string;
  motionPrompt?: string;
  durationSec?: number;
  startShotVideo?(): void;
  prepare(): Promise<void>;
  replace(
    sourceUrl: string,
    result: { imageUrl?: string; videoUrl?: string; cropped?: boolean }
  ): Promise<boolean>;
};
export const useBookMediaSession = create<{
  session: BookMediaSession | null;
  setSession(session: BookMediaSession | null): void;
}>(set => ({ session: null, setSession: session => set({ session }) }));
