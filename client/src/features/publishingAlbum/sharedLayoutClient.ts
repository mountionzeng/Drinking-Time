import {
  layoutImageRef,
  SHARED_LAYOUT_MAX_BYTES,
  SHARED_LAYOUT_MAX_IMAGES,
  type PublicSharedLayout,
  type SharedLayoutPackage,
} from "@shared/sharedLayout";
import { encodeShareImage } from "./artworkShareImages";
import type { PackAsset } from "./imagePackComposition";
import type { ModuleDocument } from "./imagePackModules";

export type SharedLayoutStored = NonNullable<PublicSharedLayout["inherited"]>;
export type SharedLayoutCandidate = PublicSharedLayout["candidates"][number];
type Anchor = SharedLayoutPackage["settings"]["illustrations"][number]["after"];

/**
 * Pictures that arrived with a shared layout (from the author, or from a friend
 * sharing back). They join the normal picture library so they can be used freely.
 */
export function sharedLayoutAssets(
  state: PublicSharedLayout | undefined
): PackAsset[] {
  if (!state) return [];
  const layouts = [
    ...(state.inherited ? [state.inherited] : []),
    ...state.candidates,
  ];
  const seen = new Map<number, PackAsset>();
  for (const layout of layouts) {
    const illustrations = new Set(
      layout.settings.illustrations.map(item => item.image)
    );
    layout.assets.forEach((asset, index) => {
      if (seen.has(asset.id)) return;
      seen.set(asset.id, {
        id: asset.id,
        imageUrl: asset.imageUrl,
        label: `来自${layout.authorName}的图片 ${index + 1}`,
        ...(illustrations.has(index)
          ? { kind: "illustration" as const }
          : layout.settings.bodyTexture === index
            ? { kind: "body-texture" as const }
            : {}),
      });
    });
  }
  return [...seen.values()];
}

/** Raw quick-layout settings for a stored layout; the editor still validates them. */
export function sharedLayoutSettings(layout: SharedLayoutStored) {
  const id = (index: number | null) =>
    index == null ? null : (layout.assets[index]?.id ?? null);
  const settings = layout.settings;
  return {
    title: settings.title,
    style: settings.style,
    fontId: settings.fontId,
    texture: settings.texture,
    textureSeed: settings.textureSeed,
    includeCover: settings.includeCover,
    coverId: id(settings.cover),
    bodyTextureId: id(settings.bodyTexture),
    illustrations: settings.illustrations.flatMap(item => {
      const assetId = id(item.image);
      return assetId == null ? [] : [{ assetId, after: item.after }];
    }),
  };
}

async function encodeUrl(url: string, budget: number, label: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${label}读取失败，请稍后重试`);
  return encodeShareImage(await response.blob(), budget, label);
}

/**
 * Package the whole layout page set: settings, hand-placed modules and every
 * picture they use. Pictures travel as bounded data URLs, never as raw URLs.
 */
export async function buildSharedLayoutPackage(input: {
  settings: Omit<
    SharedLayoutPackage["settings"],
    "cover" | "bodyTexture" | "illustrations"
  >;
  coverUrl?: string;
  bodyTextureUrl?: string;
  illustrations: Array<{ imageUrl: string; after: Anchor }>;
  modules: ModuleDocument | null;
  encode?: (url: string, budget: number, label: string) => Promise<string>;
  onProgress?: (done: number, total: number) => void;
}): Promise<SharedLayoutPackage> {
  const urls: string[] = [];
  const index = (url: string) => {
    let position = urls.indexOf(url);
    if (position < 0) position = urls.push(url) - 1;
    return position;
  };
  const cover = input.coverUrl ? index(input.coverUrl) : null;
  const bodyTexture = input.bodyTextureUrl ? index(input.bodyTextureUrl) : null;
  const illustrations = input.illustrations
    .filter(item => item.imageUrl)
    .map(item => ({ image: index(item.imageUrl), after: item.after }));
  const modules = input.modules
    ? {
        ...input.modules,
        pages: input.modules.pages.map(page => ({
          ...page,
          modules: page.modules.map(module =>
            module.kind === "image"
              ? { ...module, imageUrl: layoutImageRef(index(module.imageUrl)) }
              : module
          ),
        })),
      }
    : null;
  if (urls.length > SHARED_LAYOUT_MAX_IMAGES)
    throw new Error(
      `可编辑排版最多带 ${SHARED_LAYOUT_MAX_IMAGES} 张图片，请减少配图后再分享`
    );
  const budget = Math.min(
    4 * 1024 * 1024,
    Math.floor(SHARED_LAYOUT_MAX_BYTES / Math.max(1, urls.length))
  );
  const encode = input.encode ?? encodeUrl;
  const images: string[] = [];
  for (const [position, url] of urls.entries()) {
    input.onProgress?.(position, urls.length);
    images.push(await encode(url, budget, `排版里的第 ${position + 1} 张图片`));
  }
  input.onProgress?.(urls.length, urls.length);
  return {
    settings: { ...input.settings, cover, bodyTexture, illustrations },
    modules,
    images,
  };
}
