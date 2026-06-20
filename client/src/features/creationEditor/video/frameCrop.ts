export type FrameQuadrant = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type CroppedFrameImage = {
  imageBase64: string;
  mimeType: 'image/png';
};

export const FRAME_QUADRANTS: Array<{ value: FrameQuadrant; label: string }> = [
  { value: 'top-left', label: '左上' },
  { value: 'top-right', label: '右上' },
  { value: 'bottom-left', label: '左下' },
  { value: 'bottom-right', label: '右下' },
];

const IMAGE_LOAD_TIMEOUT_MS = 15000;

export function quadrantRect(
  quadrant: FrameQuadrant,
  width: number,
  height: number,
) {
  const halfWidth = Math.floor(width / 2);
  const halfHeight = Math.floor(height / 2);
  const left = quadrant === 'top-right' || quadrant === 'bottom-right' ? halfWidth : 0;
  const top = quadrant === 'bottom-left' || quadrant === 'bottom-right' ? halfHeight : 0;
  return {
    left,
    top,
    width: quadrant === 'top-right' || quadrant === 'bottom-right' ? width - halfWidth : halfWidth,
    height: quadrant === 'bottom-left' || quadrant === 'bottom-right' ? height - halfHeight : halfHeight,
  };
}

type CanvasImageSource = {
  src: string;
  revoke?: () => void;
};

function isInlineOrObjectImage(src: string) {
  return src.startsWith('data:') || src.startsWith('blob:');
}

async function prepareCanvasImageSource(src: string): Promise<CanvasImageSource> {
  if (isInlineOrObjectImage(src)) return { src };
  if (
    typeof fetch !== 'function' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return { src };
  }

  try {
    const response = await fetch(src, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) {
      throw new Error(`unexpected content type ${blob.type || 'unknown'}`);
    }
    const objectUrl = URL.createObjectURL(blob);
    return {
      src: objectUrl,
      revoke: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    throw new Error(
      '这张图无法在浏览器里读取成可裁切图片。通常是图片外链没有开放跨域，请先重渲成单张首帧，或把图片保存成本地资产后再试。',
    );
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const timeout = window.setTimeout(() => {
      reject(new Error('图片读取超时，请先重渲成单张首帧'));
    }, IMAGE_LOAD_TIMEOUT_MS);
    image.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('无法读取这张图片，请先重渲成单张首帧'));
    };
    image.onload = () => {
      window.clearTimeout(timeout);
      resolve(image);
    };
    image.src = src;
  });
}

export async function cropFrameQuadrant(
  imageUrl: string,
  quadrant: FrameQuadrant,
): Promise<CroppedFrameImage> {
  const prepared = await prepareCanvasImageSource(imageUrl);
  try {
    const image = await loadImage(prepared.src);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (width < 2 || height < 2) throw new Error('图片尺寸太小，无法裁切');

    const rect = quadrantRect(quadrant, width, height);
    const canvas = document.createElement('canvas');
    canvas.width = rect.width;
    canvas.height = rect.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法裁切图片');

    context.drawImage(
      image,
      rect.left,
      rect.top,
      rect.width,
      rect.height,
      0,
      0,
      rect.width,
      rect.height,
    );

    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];
    if (!base64) throw new Error('裁切图片失败');
    return { imageBase64: base64, mimeType: 'image/png' };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') {
      throw new Error('这张图是跨域外链，浏览器不能直接裁切。请先重渲成单张首帧或保存成本地资产。');
    }
    throw error;
  } finally {
    prepared.revoke?.();
  }
}
