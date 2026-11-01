import { z } from "zod";

export const CAPTURE_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const CAPTURE_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const CAPTURE_MAX_FILES = 6;
export const captureIdSchema = z.string().uuid();
export const captureFileSchema = z.object({
  id: captureIdSchema,
  name: z.string().min(1).max(200),
  mime: z.enum(["image/jpeg", "image/png", "image/webp", "audio/mpeg", "audio/mp4", "audio/wav", "audio/webm", "audio/ogg"]),
  base64: z.string().min(4).max(Math.ceil(CAPTURE_MAX_FILE_BYTES / 3) * 4),
});
export const captureInputSchema = z.object({
  id: captureIdSchema,
  origin: z.enum(["chat", "android-share", "ios-shortcut"]),
  text: z.string().max(20_000),
  files: z.array(captureFileSchema).max(CAPTURE_MAX_FILES),
}).refine(input => input.text.trim().length > 0 || input.files.length > 0, "请先添加文字、图片或录音")
  .refine(input => new Set(input.files.map(file => file.id)).size === input.files.length, "素材编号重复");
export type CaptureInput = z.infer<typeof captureInputSchema>;
export type CaptureFile = { id: string; name: string; mime: CaptureInput["files"][number]["mime"]; bytes: number; sha256: string };
export type CaptureManifest = { origin: CaptureInput["origin"]; text: string; files: CaptureFile[] };
export type CaptureEvidence = { sourceId: string; kind: "user-text" | "transcript" | "image-description"; text: string; model?: string };
export type CaptureProgress = { evidence: CaptureEvidence[]; transcriptionTasks?: Record<string, { id: string; createdAt: number }>; draft?: { title: string; body: string }; manual?: boolean; activeStep?: string; error?: string };
export type CaptureStatus = "received" | "processing" | "ready" | "saved" | "uncertain";
export type CaptureReceipt = { id: string; status: CaptureStatus; manifest: CaptureManifest; progress: CaptureProgress; storyId: number | null; createdAt: Date; updatedAt: Date };

export const CAPTURE_STATUS_LABELS: Record<CaptureStatus, string> = {
  received: "素材已保存，等待整理",
  processing: "正在整理，原件已保存",
  ready: "文字已整理，等待保存故事",
  saved: "已保存为故事",
  uncertain: "整理未完成，原件已保留",
};
