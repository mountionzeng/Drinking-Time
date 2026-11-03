import { ARTWORK_SHARE_MAX_BYTES } from "@shared/artworkShare";
import { bookShareReading } from "./bookShareArticle";
import { readImagePackBlob } from "./imagePackImageBlob";
import { encodeShareImage } from "./artworkShareImages";

/** Freeze all pictures before opening preview. A missing picture fails the whole preparation. */
export async function prepareBookShare(body: string) {
  const { reading, urls } = bookShareReading(body);
  if (!urls.length) return null;
  const pages = [];
  const budget = Math.min(4 * 1024 * 1024, Math.floor(ARTWORK_SHARE_MAX_BYTES / urls.length));
  for (const [index, url] of urls.entries()) {
    const label = `第 ${index + 1} 张插图`;
    const dataUrl = await encodeShareImage(await readImagePackBlob(url), budget, label);
    const blob = await readImagePackBlob(dataUrl);
    const bitmap = await createImageBitmap(blob);
    try { pages.push({ label, filename: `插图-${index + 1}.webp`, blob, url: dataUrl, width: bitmap.width, height: bitmap.height }); }
    finally { bitmap.close(); }
  }
  return { reading, pages };
}
