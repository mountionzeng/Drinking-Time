import type { ModuleRect } from "./imagePackModules";
export type BookImageCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export const fullBookImageCrop: BookImageCrop = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};
/** Image metadata travels with the manuscript, not only this browser's format cache. */
export function readBookImage(
  text: string
): { url: string; crop: BookImageCrop; scale: number; frame?: ModuleRect } | null {
  const match = /^!\[图片\]\(([^\s]+)(?: "book:([\d.,]+)")?\)$/.exec(text);
  if (!match || !/^(https?:\/\/|\/api\/|\/uploads\/)/.test(match[1]))
    return null;
  const result: {url: string; crop: BookImageCrop; scale: number; frame?: ModuleRect} = { url: match[1], crop: { ...fullBookImageCrop }, scale: 1 };
  if (match[2]) {
    const [x, y, width, height, scale, ...rest] = match[2]
      .split(",")
      .map(Number);
    if (
      ![0, 4].includes(rest.length) ||
      ![x, y, width, height, scale].every(Number.isFinite) ||
      x < 0 ||
      y < 0 ||
      width <= 0 ||
      height <= 0 ||
      x + width > 1.00001 ||
      y + height > 1.00001 ||
      scale < 0.5 ||
      scale > 2
    )
      return null;
    result.crop = { x, y, width, height };
    result.scale = scale;
    if (rest.length) {
      const [x,y,width,height] = rest;
      if (!rest.every(Number.isFinite) || x < 0 || y < 0 || width < 1 || height < 1 || x+width > 900.001 || y+height > 1200.001) return null;
      result.frame = {x,y,width,height};
    }
  }
  return result;
}
export const bookImageUrl = (text: string) => readBookImage(text)?.url ?? null;
export function bookImageText(
  url: string,
  crop: BookImageCrop = fullBookImageCrop,
  scale = 1,
  frame?: ModuleRect
): string {
  const safe = url
    .replaceAll("(", "%28")
    .replaceAll(")", "%29")
    .replaceAll(" ", "%20");
  const metadata = [crop.x, crop.y, crop.width, crop.height, scale, ...(frame ? [frame.x,frame.y,frame.width,frame.height] : [])]
    .map(n => Number(n.toFixed(4)))
    .join(",");
  const text = `![图片](${safe}${metadata === "0,0,1,1,1" ? "" : ` "book:${metadata}"`})`;
  if (!readBookImage(text)) throw new Error("图片地址或裁切范围不可用");
  return text;
}
