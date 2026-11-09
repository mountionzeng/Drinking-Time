import { z } from "zod";
import type { PublishingArticleLayout } from "./publishingArticleVideo";
import type { PublishingVideoStoryboardPreview } from "./publishingVideoStoryboard";
export const bookVideoBriefSchema = z.object({
  purpose: z.string().trim().min(1).max(500),
  audience: z.string().trim().min(1).max(300),
  platform: z.string().trim().max(200).optional(),
  tone: z.string().trim().min(1).max(500),
  duration: z.string().trim().min(1).max(200),
  narration: z.string().trim().min(1).max(800),
  music: z.string().trim().min(1).max(800),
  useBookMusic: z.boolean().default(true),
  reuse: z.string().trim().min(1).max(800),
  changes: z.string().trim().min(1).max(1000),
  question: z.string().trim().max(200).default(""),
});
export type BookVideoBrief = z.infer<typeof bookVideoBriefSchema>;
export type BookVideoRecord = {
  manuscriptSource?: import("./bookWorkflow").ManuscriptReference;
  creationIntent?: import("./bookWorkflow").CreationIntent;
  author?: import("./bookWorkflow").VersionActor;
  confirmedBy?: import("./bookWorkflow").VersionActor;
  id: string;
  parentId?: string;
  versionId: string;
  /** Assigned once on confirmation; separate from publishing versions and mutable revision. */
  videoVersion?: number;
  confirmedAt?: number;
  briefConfirmedAt?: number;
  createdAt: number;
  revision: number;
  bookSource?: boolean;
  sourceHash?: string;
  missingImages?: number;
  musicAssets?: Array<{ assetId: number; title: string; durationFrames: number }>;
  missingMusic?: number;
  request: string;
  layout: PublishingArticleLayout;
  status: "planning" | "proposed" | "ready" | "adopted" | "failed";
  brief?: BookVideoBrief;
  error?: string;
  preview?: PublishingVideoStoryboardPreview;
  edits?: PublishingVideoStoryboardPreview[];
  /** Original formal shots preserved when a newer book-act version replaces the active table. */
  storyboardSnapshot?: { shots: Record<string, unknown>[]; archivedAt: number };
};
export const videoShotEditSchema = z.object({
  draftShotId: z.string().min(1).max(200),
  voiceText: z.string().max(6000),
  speaker: z.string().trim().max(300).optional(),
  action: z.string().min(1).max(4000),
  imageRequirement: z.string().min(1).max(4000),
  videoRequirement: z.string().min(1).max(4000),
  soundRequirement: z.string().max(2000),
});
export const BOOK_VIDEO_QUESTION =
  "你想把这本书做成什么样的视频？先随便说说画面、感觉或用途，不用一次想完整。";

/** Legacy confirmed plans retain a stable display order until a new confirmation assigns explicit numbers. */
export function confirmedBookVideoVersions(records: BookVideoRecord[]) {
  let sequence = 0;
  return records.filter(record => record.status === "adopted").map(record => {
    sequence = Math.max(sequence + 1, record.videoVersion ?? 0);
    return { record, version: record.videoVersion ?? sequence };
  });
}
