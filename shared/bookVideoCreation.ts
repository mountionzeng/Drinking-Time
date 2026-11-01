import { z } from "zod";
import type { PublishingArticleLayout } from "./publishingArticleVideo";
import type { PublishingVideoStoryboardPreview } from "./publishingVideoStoryboard";
export const bookVideoBriefSchema = z.object({
  purpose: z.string().trim().min(1).max(500),
  audience: z.string().trim().min(1).max(300),
  tone: z.string().trim().min(1).max(500),
  duration: z.string().trim().min(1).max(200),
  narration: z.string().trim().min(1).max(800),
  music: z.string().trim().min(1).max(800),
  reuse: z.string().trim().min(1).max(800),
  changes: z.string().trim().min(1).max(1000),
  question: z.string().trim().max(200).default(""),
});
export type BookVideoBrief = z.infer<typeof bookVideoBriefSchema>;
export type BookVideoRecord = {
  id: string;
  parentId?: string;
  versionId: string;
  createdAt: number;
  revision: number;
  bookSource?: boolean;
  sourceHash?: string;
  missingImages?: number;
  request: string;
  layout: PublishingArticleLayout;
  status: "planning" | "proposed" | "ready" | "adopted" | "failed";
  brief?: BookVideoBrief;
  error?: string;
  preview?: PublishingVideoStoryboardPreview;
  edits?: PublishingVideoStoryboardPreview[];
};
export const videoShotEditSchema = z.object({
  draftShotId: z.string().min(1).max(200),
  voiceText: z.string().max(6000),
  action: z.string().min(1).max(4000),
  imageRequirement: z.string().min(1).max(4000),
  videoRequirement: z.string().min(1).max(4000),
  soundRequirement: z.string().max(2000),
});
export const BOOK_VIDEO_QUESTION =
  "这个视频准备给谁看？希望看完有什么感受，或做什么？";
