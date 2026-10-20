import type { StoryMaterialState } from "@shared/storyMaterial";
import type { PackAsset } from "./imagePackComposition";

/** The archive belongs to the story, not its active text version. */
export function storyLibraryImages(storyId: number, material?: StoryMaterialState | null): PackAsset[] {
  if (!material || material.storyId !== storyId) return [];
  const images = [
    ...(material.warehouseImages ?? material.unassignedImages),
    ...material.shots.flatMap(shot => [...shot.imageVersions, ...(shot.relatedImages ?? [])]),
    ...(material.visualAssets?.images ?? []),
  ];
  const unique = new Map<number, PackAsset>();
  for (const image of images) {
    if (image.storyId !== storyId || unique.has(image.id) || !image.imageUrl) continue;
    unique.set(image.id, {
      id: image.id,
      imageUrl: image.imageUrl,
      label: image.canonicalShotNo ? `${image.canonicalShotNo} · 图片 ${image.id}` : `故事图片 ${image.id}`,
      warning: image.availability === "missing" ? "原文件缺失" : undefined,
    });
  }
  return [...unique.values()];
}

/** Read other versions without moving or rewriting their scoped upload storage. */
export function readStoryLocalImages(storyId: number, storage: Pick<Storage, "length" | "key" | "getItem">): PackAsset[] {
  const images = new Map<number, PackAsset>();
  const prefix = `publishing-layout-images:${storyId}:`;
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      try {
        const values = JSON.parse(storage.getItem(key) ?? "[]");
        if (!Array.isArray(values)) continue;
        for (const value of values) {
          if (value && Number.isSafeInteger(value.id) && value.id < 0 &&
            typeof value.label === "string" && typeof value.imageUrl === "string" &&
            /^data:image\/(png|jpeg|webp);base64,/.test(value.imageUrl)) {
            images.set(value.id, { id: value.id, label: value.label, imageUrl: value.imageUrl });
          }
        }
      } catch { /* One broken version must not hide the other pictures. */ }
    }
  } catch { /* Current-session uploads remain usable when storage is unavailable. */ }
  return [...images.values()];
}
