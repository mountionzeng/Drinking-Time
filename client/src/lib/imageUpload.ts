export type ImageUploadProfile = "analysis" | "chat";

export type OptimizedImageUpload = {
  base64: string;
  dataUrl: string;
  fileName: string;
  mimeType: string;
  originalBytes: number;
  optimizedBytes: number;
  width?: number;
  height?: number;
  wasOptimized: boolean;
};

type OptimizeOptions = {
  profile?: ImageUploadProfile;
  maxDimension?: number;
  quality?: number;
  skipIfUnderBytes?: number;
};

const PROFILE_DEFAULTS: Record<
  ImageUploadProfile,
  Required<Pick<OptimizeOptions, "maxDimension" | "quality" | "skipIfUnderBytes">>
> = {
  analysis: {
    maxDimension: 1600,
    quality: 0.78,
    skipIfUnderBytes: 900 * 1024,
  },
  chat: {
    maxDimension: 1280,
    quality: 0.72,
    skipIfUnderBytes: 650 * 1024,
  },
};

const PASSTHROUGH_IMAGE_TYPES = new Set([
  "image/gif",
  "image/svg+xml",
  "image/x-icon",
]);

export async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await blobToDataUrl(blob);
  return dataUrlToBase64(dataUrl);
}

export async function optimizeImageForUpload(
  file: File,
  options: OptimizeOptions = {},
): Promise<OptimizedImageUpload> {
  const profile = options.profile ?? "chat";
  const defaults = PROFILE_DEFAULTS[profile];
  const maxDimension = options.maxDimension ?? defaults.maxDimension;
  const quality = options.quality ?? defaults.quality;
  const skipIfUnderBytes = options.skipIfUnderBytes ?? defaults.skipIfUnderBytes;
  const originalMimeType = file.type || "application/octet-stream";

  if (!originalMimeType.startsWith("image/") || PASSTHROUGH_IMAGE_TYPES.has(originalMimeType)) {
    return originalUpload(file, originalMimeType);
  }

  if (
    file.size <= skipIfUnderBytes &&
    (originalMimeType === "image/jpeg" || originalMimeType === "image/webp")
  ) {
    return originalUpload(file, originalMimeType);
  }

  try {
    const image = await loadImage(file);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;

    if (!sourceWidth || !sourceHeight) {
      return originalUpload(file, originalMimeType);
    }

    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return originalUpload(file, originalMimeType);

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    if (!blob) return originalUpload(file, originalMimeType);

    const resized = targetWidth !== sourceWidth || targetHeight !== sourceHeight;
    const meaningfullySmaller = blob.size < file.size * 0.92;
    if (!resized && !meaningfullySmaller) {
      return originalUpload(file, originalMimeType, sourceWidth, sourceHeight);
    }

    const dataUrl = await blobToDataUrl(blob);
    return {
      base64: dataUrlToBase64(dataUrl),
      dataUrl,
      fileName: withJpegExtension(file.name),
      mimeType: "image/jpeg",
      originalBytes: file.size,
      optimizedBytes: blob.size,
      width: targetWidth,
      height: targetHeight,
      wasOptimized: true,
    };
  } catch (error) {
    console.warn("[imageUpload] image optimization skipped:", error);
    return originalUpload(file, originalMimeType);
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

async function originalUpload(
  file: File,
  mimeType: string,
  width?: number,
  height?: number,
): Promise<OptimizedImageUpload> {
  const dataUrl = await blobToDataUrl(file);
  return {
    base64: dataUrlToBase64(dataUrl),
    dataUrl,
    fileName: file.name,
    mimeType,
    originalBytes: file.size,
    optimizedBytes: file.size,
    width,
    height,
    wasOptimized: false,
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
}

function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.split(",")[1] || dataUrl;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image decode failed"));
    };
    image.src = url;
  });
}

function withJpegExtension(fileName: string): string {
  const trimmed = fileName.trim() || `image-${Date.now()}`;
  if (/\.[a-z0-9]+$/i.test(trimmed)) {
    return trimmed.replace(/\.[a-z0-9]+$/i, ".jpg");
  }
  return `${trimmed}.jpg`;
}
