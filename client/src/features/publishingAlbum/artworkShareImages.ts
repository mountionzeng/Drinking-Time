import {
  ARTWORK_SHARE_MAX_BYTES,
  ARTWORK_SHARE_MAX_PAGES,
} from "@shared/artworkShare";

/** Share a bounded reading copy; keep the original PNGs for download. */
export async function prepareArtworkShareImages(
  blobs: Blob[],
  onProgress?: (done: number, total: number) => void
): Promise<string[]> {
  if (!blobs.length || blobs.length > ARTWORK_SHARE_MAX_PAGES)
    throw new Error("请选择 1 至 9 张成品图片");
  // The API limits base64 characters, not binary file sizes.
  const budget = Math.min(
    4 * 1024 * 1024,
    Math.floor(ARTWORK_SHARE_MAX_BYTES / blobs.length)
  );
  const pages: string[] = [];
  for (const [index, blob] of blobs.entries()) {
    onProgress?.(index, blobs.length);
    const url = URL.createObjectURL(blob);
    const canvas = document.createElement("canvas");
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () =>
          reject(new Error(`第 ${index + 1} 张图片读取失败，请重新排版`));
        image.src = url;
      });
      let encoded = "";
      for (const width of [1080, 900, 720]) {
        const scale = Math.min(
          1,
          width / image.naturalWidth,
          Math.sqrt(4_000_000 / (image.naturalWidth * image.naturalHeight))
        );
        canvas.width = Math.max(1, Math.floor(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.floor(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("浏览器无法处理图片，请换一个浏览器重试");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.9, 0.8]) {
          const candidate = canvas.toDataURL("image/webp", quality);
          if (
            /^data:image\/(webp|png);base64,/.test(candidate) &&
            candidate.length <= budget
          ) {
            encoded = candidate;
            break;
          }
        }
        if (encoded) break;
      }
      if (!encoded)
        throw new Error(
          `第 ${index + 1} 张图片压缩后仍过大，请减少图片后再分享`
        );
      pages.push(encoded);
    } finally {
      URL.revokeObjectURL(url);
      canvas.width = canvas.height = 0;
    }
  }
  onProgress?.(blobs.length, blobs.length);
  return pages;
}
