import type { ImportedStoryMaterialResult } from "@/features/creationEditor/types";

export const STORYBOARD_MEDIA_ACCEPT =
  "image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime";

export const STORYBOARD_IMAGE_DRAG_MIME = "application/x-dt-storyboard-image";

export type StoryboardImageDragPayload = {
  imageId: number;
  sourceStableShotId: string;
  sourceShotNo: number;
};

export const STORYBOARD_IMAGE_MAX_BYTES = 30 * 1024 * 1024;
export const STORYBOARD_VIDEO_MAX_BYTES = 200 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_MIMES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

type StoryboardMediaFileInfo = Pick<File, "name" | "size" | "type">;

export function writeStoryboardImageDragPayload(
  dataTransfer: DataTransfer,
  payload: StoryboardImageDragPayload
) {
  dataTransfer.effectAllowed = "move";
  dataTransfer.setData(STORYBOARD_IMAGE_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData("text/plain", `Image ${payload.imageId}`);
}

export function hasStoryboardImageDragPayload(
  dataTransfer: DataTransfer
): boolean {
  return Array.from(dataTransfer.types).includes(STORYBOARD_IMAGE_DRAG_MIME);
}

export function readStoryboardImageDragPayload(
  dataTransfer: DataTransfer
): StoryboardImageDragPayload | null {
  try {
    const raw = dataTransfer.getData(STORYBOARD_IMAGE_DRAG_MIME);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoryboardImageDragPayload>;
    if (
      !Number.isInteger(parsed.imageId) ||
      Number(parsed.imageId) <= 0 ||
      typeof parsed.sourceStableShotId !== "string" ||
      !parsed.sourceStableShotId.trim() ||
      !Number.isInteger(parsed.sourceShotNo) ||
      Number(parsed.sourceShotNo) <= 0
    ) {
      return null;
    }
    return {
      imageId: Number(parsed.imageId),
      sourceStableShotId: parsed.sourceStableShotId,
      sourceShotNo: Number(parsed.sourceShotNo),
    };
  } catch {
    return null;
  }
}

export function storyboardMediaMime(file: Pick<File, "name" | "type">): string {
  const declared = file.type.trim().toLowerCase();
  if (declared) return declared;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

export function storyboardMediaKind(
  file: Pick<File, "name" | "type">
): "image" | "video" | null {
  const mimeType = storyboardMediaMime(file);
  if (IMAGE_MIMES.has(mimeType)) return "image";
  if (VIDEO_MIMES.has(mimeType)) return "video";
  return null;
}

export function storyboardMediaValidationError(
  file: StoryboardMediaFileInfo
): string | null {
  const kind = storyboardMediaKind(file);
  if (!kind) return "只支持 JPG、PNG、WEBP、MP4、WEBM 和 MOV";
  if (kind === "image" && file.size > STORYBOARD_IMAGE_MAX_BYTES) {
    return "图片不能超过 30MB";
  }
  if (kind === "video" && file.size > STORYBOARD_VIDEO_MAX_BYTES) {
    return "视频不能超过 200MB";
  }
  return null;
}

export function readStoryboardMediaBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const separator = value.indexOf(",");
      if (separator < 0) reject(new Error("文件编码失败"));
      else resolve(value.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

export type StoryboardMediaImportBatchResult = {
  imageCount: number;
  videoCount: number;
  adoptedVideoCount: number;
  images: Array<Extract<ImportedStoryMaterialResult, { kind: "image" }>>;
  videos: Array<Extract<ImportedStoryMaterialResult, { kind: "video" }>>;
  rejected: Array<{ fileName: string; reason: string }>;
};

export async function importStoryboardMediaFiles(input: {
  files: File[];
  stableShotId: string;
  note: string;
  importMaterial: (input: {
    fileName: string;
    mimeType: string;
    fileBase64: string;
    targetStableShotId?: string | null;
    note?: string;
  }) => Promise<ImportedStoryMaterialResult>;
  adoptVideoTake?: (input: {
    stableShotId: string;
    takeId: number;
    plannedDurationSec: number;
  }) => Promise<void>;
  readBase64?: (file: File) => Promise<string>;
}): Promise<StoryboardMediaImportBatchResult> {
  const readBase64 = input.readBase64 ?? readStoryboardMediaBase64;
  const accepted: File[] = [];
  const rejected: StoryboardMediaImportBatchResult["rejected"] = [];

  for (const file of input.files) {
    const reason = storyboardMediaValidationError(file);
    if (reason) rejected.push({ fileName: file.name, reason });
    else accepted.push(file);
  }
  if (accepted.length === 0) {
    throw new Error(rejected[0]?.reason ?? "没有可导入的图片或视频");
  }

  let imageCount = 0;
  let videoCount = 0;
  let adoptedVideoCount = 0;
  const images: StoryboardMediaImportBatchResult["images"] = [];
  const videos: StoryboardMediaImportBatchResult["videos"] = [];
  for (const file of accepted) {
    const result = await input.importMaterial({
      fileName: file.name,
      mimeType: storyboardMediaMime(file),
      fileBase64: await readBase64(file),
      targetStableShotId: input.stableShotId,
      note: input.note,
    });
    if (result.kind === "image") {
      imageCount += 1;
      images.push(result);
      continue;
    }
    videoCount += 1;
    videos.push(result);
    if (input.adoptVideoTake) {
      await input.adoptVideoTake({
        stableShotId: result.stableShotId,
        takeId: result.takeId,
        plannedDurationSec: result.plannedDurationSec,
      });
      adoptedVideoCount += 1;
    }
  }

  return {
    imageCount,
    videoCount,
    adoptedVideoCount,
    images,
    videos,
    rejected,
  };
}
