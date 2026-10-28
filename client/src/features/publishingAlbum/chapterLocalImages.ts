import type { ChapterEdit } from "./useChapters";

/** Keep image bytes outside the bounded layout JSON. The server owns storage keys. */
export function chapterLocalImages(edit: ChapterEdit) {
  const images: Array<{ ref: string; base64: string }> = [];
  const refs = new Map<string, string>();
  const key = (url: string | null): string | null => {
    if (!url?.startsWith("data:")) return url;
    const existing = refs.get(url);
    if (existing) return existing;
    const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
    if (!match || match[1].length > 2_800_000) throw new Error("图片格式不支持或超过 2 MB，请重新选择");
    if (images.length >= 12) throw new Error("一章最多保存 12 张图片");
    const ref = `local-image:${images.length}`;
    images.push({ ref, base64: match[1] }); refs.set(url, ref);
    return ref;
  };
  return {
    ...edit,
    layout: edit.layout ? { ...edit.layout, pages: edit.layout.pages.map(page => ({ ...page, modules: page.modules.map(module => module.kind === "image" ? { ...module, imageUrl: key(module.imageUrl)! } : module) })) } : null,
    media: edit.media ? { coverKey: key(edit.media.coverKey), bodyTextureKey: key(edit.media.bodyTextureKey), illustrations: edit.media.illustrations.map(image => ({ ...image, key: key(image.key)! })) } : undefined,
    localImages: images,
  };
}
