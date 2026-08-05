import {
  PUBLISHING_PLATFORM_REGISTRY,
  type PublishingPlatformId,
} from "@shared/publishingDraft";

export type PublishingCoverCrop = {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
};

export type PublishingCoverExportPlan = {
  platform: PublishingPlatformId;
  output: { width: number; height: number };
  crop: PublishingCoverCrop;
  safeRect: { x: number; y: number; width: number; height: number };
};

export function coverCropRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): PublishingCoverCrop {
  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    targetWidth <= 0 ||
    targetHeight <= 0
  ) {
    throw new Error("封面尺寸无效");
  }
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  if (sourceRatio > targetRatio) {
    const width = sourceHeight * targetRatio;
    return {
      sourceX: (sourceWidth - width) / 2,
      sourceY: 0,
      sourceWidth: width,
      sourceHeight,
    };
  }
  const height = sourceWidth / targetRatio;
  return {
    sourceX: 0,
    sourceY: (sourceHeight - height) / 2,
    sourceWidth,
    sourceHeight: height,
  };
}

export function buildPublishingCoverExportPlan(params: {
  platform: PublishingPlatformId;
  sourceWidth: number;
  sourceHeight: number;
}): PublishingCoverExportPlan {
  const adapter = PUBLISHING_PLATFORM_REGISTRY[params.platform];
  const { width, height, safeArea } = adapter.cover;
  return {
    platform: params.platform,
    output: { width, height },
    crop: coverCropRect(params.sourceWidth, params.sourceHeight, width, height),
    safeRect: {
      x: width * safeArea.left,
      y: height * safeArea.top,
      width: width * (safeArea.right - safeArea.left),
      height: height * (safeArea.bottom - safeArea.top),
    },
  };
}

export function wrapPublishingCoverTitle(params: {
  title: string;
  maxWidth: number;
  maxLines: number;
  measure: (value: string) => number;
}): string[] {
  const title = params.title.trim().replace(/\s+/g, " ");
  if (!title || params.maxLines < 1 || params.maxWidth <= 0) return [];
  const characters = Array.from(title);
  const lines: string[] = [];
  let cursor = 0;

  while (cursor < characters.length && lines.length < params.maxLines) {
    let line = "";
    while (cursor < characters.length) {
      const candidate = `${line}${characters[cursor]}`;
      if (line && params.measure(candidate) > params.maxWidth) break;
      line = candidate;
      cursor += 1;
    }
    lines.push(line.trim());
  }

  if (cursor < characters.length && lines.length > 0) {
    let finalLine = lines[lines.length - 1].replace(/…$/, "");
    while (finalLine && params.measure(`${finalLine}…`) > params.maxWidth) {
      finalLine = Array.from(finalLine).slice(0, -1).join("");
    }
    lines[lines.length - 1] = `${finalLine.trimEnd()}…`;
  }
  return lines.filter(Boolean);
}

export function publishingCoverFileName(
  storyTitle: string,
  platform: PublishingPlatformId
): string {
  const adapter = PUBLISHING_PLATFORM_REGISTRY[platform];
  const safeTitle =
    storyTitle
      .normalize("NFKC")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 72) || "publishing-cover";
  return `${safeTitle}-${adapter.shortLabel}-${adapter.cover.width}x${adapter.cover.height}.png`;
}

type PreparedImageSource = { src: string; revoke?: () => void };

async function prepareImageSource(
  imageUrl: string
): Promise<PreparedImageSource> {
  if (imageUrl.startsWith("data:") || imageUrl.startsWith("blob:")) {
    return { src: imageUrl };
  }
  const response = await fetch(imageUrl, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`封面读取失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("封面资源不是图片");
  const objectUrl = URL.createObjectURL(blob);
  return { src: objectUrl, revoke: () => URL.revokeObjectURL(objectUrl) };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("封面图片无法读取"));
    image.src = src;
  });
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("封面导出失败"));
    }, "image/png");
  });
}

export async function renderPublishingCover(params: {
  imageUrl: string;
  platform: PublishingPlatformId;
  title?: string;
}): Promise<Blob> {
  const prepared = await prepareImageSource(params.imageUrl);
  try {
    const image = await loadImage(prepared.src);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const plan = buildPublishingCoverExportPlan({
      platform: params.platform,
      sourceWidth,
      sourceHeight,
    });
    const canvas = document.createElement("canvas");
    canvas.width = plan.output.width;
    canvas.height = plan.output.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法导出封面");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      plan.crop.sourceX,
      plan.crop.sourceY,
      plan.crop.sourceWidth,
      plan.crop.sourceHeight,
      0,
      0,
      plan.output.width,
      plan.output.height
    );

    const title = params.title?.trim() ?? "";
    if (title) {
      const fontSize = Math.round(
        Math.max(42, Math.min(82, plan.output.width * 0.058))
      );
      context.font = `700 ${fontSize}px "Noto Serif SC", serif`;
      context.textBaseline = "top";
      const lines = wrapPublishingCoverTitle({
        title,
        maxWidth: plan.safeRect.width,
        maxLines: 3,
        measure: value => context.measureText(value).width,
      });
      if (lines.length > 0) {
        const lineHeight = Math.round(fontSize * 1.28);
        const blockHeight = lineHeight * lines.length;
        const textY = Math.max(
          plan.safeRect.y,
          plan.safeRect.y + plan.safeRect.height - blockHeight
        );
        const gradient = context.createLinearGradient(
          0,
          Math.max(0, textY - lineHeight * 1.8),
          0,
          plan.output.height
        );
        gradient.addColorStop(0, "rgba(0,0,0,0)");
        gradient.addColorStop(1, "rgba(0,0,0,0.72)");
        context.fillStyle = gradient;
        context.fillRect(
          0,
          Math.max(0, textY - lineHeight * 1.8),
          plan.output.width,
          plan.output.height
        );
        context.fillStyle = "#fff";
        context.shadowColor = "rgba(0,0,0,0.35)";
        context.shadowBlur = 10;
        lines.forEach((line, index) => {
          context.fillText(line, plan.safeRect.x, textY + index * lineHeight);
        });
      }
    }
    return await canvasBlob(canvas);
  } catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError") {
      throw new Error("浏览器阻止了封面裁切，请刷新后重试");
    }
    throw error;
  } finally {
    prepared.revoke?.();
  }
}

export async function downloadPublishingCover(params: {
  imageUrl: string;
  platform: PublishingPlatformId;
  title?: string;
  storyTitle: string;
}): Promise<void> {
  const blob = await renderPublishingCover(params);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = publishingCoverFileName(
      params.storyTitle,
      params.platform
    );
    anchor.rel = "noopener";
    anchor.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}
