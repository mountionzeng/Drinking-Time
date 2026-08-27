import type { ChatImageRef } from "./chatImageRefs";

export const MAX_CHAT_MEDIA_ATTACHMENTS = 8;
export const MAX_CHAT_IMAGE_BYTES = 30 * 1024 * 1024;
export const MAX_CHAT_VIDEO_BYTES = 200 * 1024 * 1024;

export type ChatMediaKind = "image" | "video";

export type PendingChatMedia = {
  id: string;
  file: File;
  fileKey: string;
  kind: ChatMediaKind;
  mimeType: string;
  previewUrl: string;
};

export type ImportedChatMedia = {
  kind: ChatMediaKind;
  fileName: string;
  assetId: number;
  /** Imported generated_images URL. Present for images that can become image-to-image refs. */
  imageUrl?: string;
  targetShotNo?: number | null;
  targetCueCode?: string | null;
};

export type ChatMediaRejection = {
  fileName: string;
  reason: string;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  m4v: "video/mp4",
  mov: "video/quicktime",
  mp4: "video/mp4",
  png: "image/png",
  webm: "video/webm",
  webp: "image/webp",
};

export function inferChatMediaMime(file: Pick<File, "name" | "type">): string {
  if (file.type) return file.type;
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

export function chatMediaKind(
  file: Pick<File, "name" | "type">
): ChatMediaKind | null {
  const mimeType = inferChatMediaMime(file);
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return null;
}

export function chatMediaFileKey(
  file: Pick<File, "name" | "size" | "lastModified">
): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function selectChatMediaFiles(input: {
  files: FileList | File[];
  existingKeys?: ReadonlySet<string>;
  availableSlots?: number;
}): { accepted: File[]; rejected: ChatMediaRejection[] } {
  const existingKeys = input.existingKeys ?? new Set<string>();
  const availableSlots = Math.max(
    0,
    input.availableSlots ?? MAX_CHAT_MEDIA_ATTACHMENTS
  );
  const accepted: File[] = [];
  const rejected: ChatMediaRejection[] = [];
  const seen = new Set(existingKeys);

  for (const file of Array.from(input.files)) {
    const kind = chatMediaKind(file);
    const key = chatMediaFileKey(file);
    if (!kind) {
      rejected.push({ fileName: file.name, reason: "只支持图片或视频" });
      continue;
    }
    if (seen.has(key)) {
      rejected.push({ fileName: file.name, reason: "已经添加过" });
      continue;
    }
    if (accepted.length >= availableSlots) {
      rejected.push({
        fileName: file.name,
        reason: `一次最多添加 ${MAX_CHAT_MEDIA_ATTACHMENTS} 个素材`,
      });
      continue;
    }
    const maxBytes =
      kind === "image" ? MAX_CHAT_IMAGE_BYTES : MAX_CHAT_VIDEO_BYTES;
    if (file.size > maxBytes) {
      rejected.push({
        fileName: file.name,
        reason: kind === "image" ? "图片超过 30MB" : "视频超过 200MB",
      });
      continue;
    }
    accepted.push(file);
    seen.add(key);
  }

  return { accepted, rejected };
}

export function readChatMediaBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("文件读取失败"));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? (value.split(",").pop() ?? "") : value);
    };
    reader.readAsDataURL(file);
  });
}

export function buildImportedMediaPrompt(
  userText: string,
  imported: ImportedChatMedia[]
): string {
  const list = imported
    .map((item, index) => {
      const idLabel = item.kind === "image" ? `图片 #${item.assetId}` : `Take #${item.assetId}`;
      const target =
        item.kind === "video" && item.targetShotNo != null
          ? `，暂放 ${item.targetCueCode?.trim() || String(item.targetShotNo).padStart(2, "0")}`
          : "，待归类";
      return `${index + 1}. ${item.fileName}（${idLabel}${target}）`;
    })
    .join("\n");
  const instruction = userText.trim() || "请结合当前故事分析这些素材";

  return [
    instruction,
    "",
    "我刚把下面的素材放进当前故事素材库：",
    list,
    "请先判断它们各自适合哪个镜头、怎样与前后镜头衔接，以及还需要怎样裁切、调色或做成动态；先给建议，不要自动覆盖已有时间线。",
  ].join("\n");
}

const IMAGE_GENERATION_INTENT =
  /(?:生成.{0,12}(?:一张|图片|图像|插画|照片|海报|画面|新图)|生图|出图|画(?:一张|成|出来)?|重绘|重画|改图|(?:做成|变成|换成).{0,12}(?:一张|图片|图像|插画|照片|海报|画面|水彩|油画|漫画|卡通|视觉|风格)|generate|create\s+(?:an?\s+)?image|turn\s+.+\s+into|redraw|restyle)/i;
const NEGATED_IMAGE_GENERATION_INTENT =
  /(?:不要|不用|无需|别).{0,12}(?:生成|生图|出图|画|重绘|重画|改图)|(?:do\s+not|don't).{0,20}(?:generate|create|redraw|restyle)/i;

/**
 * Dragged media is a general material-import surface, not an implicit paid job.
 * Route to image-to-image only when an imported image exists and the user's own
 * instruction explicitly asks for a new visual. Analysis requests stay in chat.
 */
export function isImportedImageGenerationRequest(input: {
  instruction: string;
  imported: readonly ImportedChatMedia[];
}): boolean {
  const instruction = input.instruction.trim();
  if (!instruction || !input.imported.some(item => item.kind === "image")) {
    return false;
  }
  if (NEGATED_IMAGE_GENERATION_INTENT.test(instruction)) return false;
  return IMAGE_GENERATION_INTENT.test(instruction);
}

/** Convert freshly persisted uploads into the same reference identity every panel uses. */
export function buildImportedImageRefs(
  imported: readonly ImportedChatMedia[]
): ChatImageRef[] {
  return imported.flatMap(item =>
    item.kind === "image" && item.imageUrl
      ? [
          {
            imageId: item.assetId,
            imageUrl: item.imageUrl,
            label: `${item.fileName} · 聊聊上传`,
          },
        ]
      : []
  );
}

export async function extractImportedPhotoFeatures(input: {
  imported: readonly ImportedChatMedia[];
  extract: (photo: {
    imageId: number;
    sourceLabel: string;
  }) => Promise<{ createdKinds: Array<"character" | "pet" | "scene"> }>;
  onProgress?: (completed: number, total: number) => void;
}): Promise<{
  createdKinds: Array<"character" | "pet" | "scene">;
  failures: string[];
}> {
  const photos = input.imported.filter(item => item.kind === "image");
  const createdKinds = new Set<"character" | "pet" | "scene">();
  const failures: string[] = [];
  for (let index = 0; index < photos.length; index += 1) {
    const photo = photos[index]!;
    input.onProgress?.(index + 1, photos.length);
    try {
      const result = await input.extract({
        imageId: photo.assetId,
        sourceLabel: photo.fileName,
      });
      result.createdKinds.forEach(kind => createdKinds.add(kind));
    } catch (error) {
      failures.push(
        `${photo.fileName}：${
          error instanceof Error ? error.message : "特征提取失败"
        }`
      );
    }
  }
  return { createdKinds: [...createdKinds], failures };
}
