import { create } from "zustand";
import type { PublishingArticleLayout } from "@shared/publishingArticleVideo";
export type BookVideoSession = {
  storyId: number;
  accountId: number | null;
  epoch: number;
  versionId: string;
  layout: PublishingArticleLayout;
  preferredDuration?: string;
  onAdopt?(): Promise<void>;
  onAlbum?(): void;
};
export const useBookVideoSession = create<{
  session: BookVideoSession | null;
  setSession(session: BookVideoSession | null): void;
}>(set => ({ session: null, setSession: session => set({ session }) }));
