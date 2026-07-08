/**
 * 从视频提取指定时间点的帧，返回 base64 data URL。
 * 支持 URL 字符串或本地 File 对象。
 * 用于在出图时把视频帧作为 FLUX Kontext 的参考图。
 */
export type CapturedReferenceFrame = {
  frameUrl: string;
  identityCropUrl: string;
};

const MAX_REFERENCE_FRAME_SIZE = 1024;
const MAX_IDENTITY_CROP_SIZE = 768;
const JPEG_QUALITY = 0.88;

export async function captureFrameFromVideoUrl(
  videoUrl: string,
  timeSec = 0.5
): Promise<string> {
  return (await captureReferenceFrameFromSource(videoUrl, timeSec)).frameUrl;
}

export async function captureFrameFromFile(
  file: File,
  timeSec = 0.5
): Promise<string> {
  return (await captureReferenceFrameFromFile(file, timeSec)).frameUrl;
}

export async function captureReferenceFrameFromVideoUrl(
  videoUrl: string,
  timeSec = 0.5
): Promise<CapturedReferenceFrame> {
  return captureReferenceFrameFromSource(videoUrl, timeSec);
}

export async function captureReferenceFrameFromFile(
  file: File,
  timeSec = 0.5
): Promise<CapturedReferenceFrame> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await captureReferenceFrameFromSource(objectUrl, timeSec);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function identityCropRect(width: number, height: number) {
  const portrait = height >= width;
  const cropWidth = Math.round(width * (portrait ? 0.72 : 0.56));
  const cropHeight = Math.round(height * (portrait ? 0.44 : 0.62));
  const centerX = width / 2;
  const centerY = height * (portrait ? 0.43 : 0.5);
  const left = Math.max(0, Math.min(width - cropWidth, Math.round(centerX - cropWidth / 2)));
  const top = Math.max(0, Math.min(height - cropHeight, Math.round(centerY - cropHeight / 2)));
  return { left, top, width: cropWidth, height: cropHeight };
}

function fitWithin(width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

function shouldUseAnonymousCrossOrigin(src: string): boolean {
  try {
    const url = new URL(src, window.location.href);
    return url.protocol !== "blob:" && url.origin !== window.location.origin;
  } catch {
    return false;
  }
}

async function captureReferenceFrameFromSource(
  src: string,
  timeSec: number
): Promise<CapturedReferenceFrame> {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  if (shouldUseAnonymousCrossOrigin(src)) {
    video.crossOrigin = "anonymous";
  }
  video.src = src;

  const cleanup = () => {
    video.removeAttribute("src");
    video.load();
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("视频加载超时")),
        10_000
      );
      video.onloadeddata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error("视频加载失败"));
      };
    });

    const duration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : 0;
    const targetTime =
      duration > 0 ? Math.min(timeSec, Math.max(0, duration - 0.05)) : timeSec;

    if (Math.abs(video.currentTime - targetTime) > 0.01) {
      video.currentTime = targetTime;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("视频帧定位超时")),
          5_000
        );
        video.onseeked = () => {
          clearTimeout(timer);
          resolve();
        };
        video.onerror = () => {
          clearTimeout(timer);
          reject(new Error("视频帧定位失败"));
        };
      });
    }

    if (!video.videoWidth || !video.videoHeight) {
      throw new Error("视频没有可读取的画面尺寸");
    }

    const canvas = document.createElement("canvas");
    const frameSize = fitWithin(
      video.videoWidth,
      video.videoHeight,
      MAX_REFERENCE_FRAME_SIZE
    );
    canvas.width = frameSize.width;
    canvas.height = frameSize.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器无法创建画布");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const crop = identityCropRect(canvas.width, canvas.height);
    const cropCanvas = document.createElement("canvas");
    const cropSize = fitWithin(crop.width, crop.height, MAX_IDENTITY_CROP_SIZE);
    cropCanvas.width = cropSize.width;
    cropCanvas.height = cropSize.height;
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) throw new Error("浏览器无法创建人物锚点画布");
    cropCtx.drawImage(
      canvas,
      crop.left,
      crop.top,
      crop.width,
      crop.height,
      0,
      0,
      cropCanvas.width,
      cropCanvas.height
    );

    return {
      frameUrl: canvasDataUrl(canvas),
      identityCropUrl: canvasDataUrl(cropCanvas),
    };
  } finally {
    cleanup();
  }
}
