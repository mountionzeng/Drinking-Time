import { activeArtSystemRecipe } from "../../shared/artSystem";
import type { ShotRenderReferences } from "../../shared/shotImageRender";
import { getGeneratedImageById } from "../repositories/images";
import { readOwnedImageBytes } from "./ownedImageBytes";
import { isProviderPublicImageUrl, needsProviderImageCopy } from "../../shared/providerImageUrl";

export const FILM_STYLE_UNREADABLE =
  "全片画风参考图片无法读取，请在对话中更换或停用；本次未提交生成";
export const FILM_STYLE_MISSING =
  "全片画风参考图片已失效，请在对话中更换或停用；本次未提交生成";
export const FILM_STYLE_STALE =
  "全片画风参考已更新，请刷新后重新确认；本次未提交生成";
export const FILM_STYLE_HOST_FAILED =
  "全片画风参考未能托管为供应商可读取的地址，请稍后重试或在对话中更换；本次未提交生成";

export type StyleCopyTarget = { imageId: number; imageUrl: string; needsCopy: boolean };

/** Prefer the confirmed film-style image; otherwise a cover used as the default style. */
export function styleCopyTarget(input: {
  filmStyleImageId?: number | null;
  coverImageId?: number | null;
  defaultReferenceId?: number | null;
  images: { id: number; imageUrl?: string | null }[];
}): StyleCopyTarget | null {
  const imageId = input.filmStyleImageId
    ?? (input.defaultReferenceId && input.defaultReferenceId === input.coverImageId ? input.coverImageId : null);
  if (!imageId) return null;
  const image = input.images.find(item => item.id === imageId);
  if (!image?.imageUrl) return null;
  return { imageId, imageUrl: image.imageUrl, needsCopy: needsProviderImageCopy(image.imageUrl) };
}

export async function inspectFilmStyleImage(input: {
  storyId: number; userId: number; imageId?: number | null; imageUrl?: string | null;
}): Promise<{ needsCopy: boolean; readable: boolean; error?: string }> {
  if (!input.imageId) return { needsCopy: false, readable: true };
  const image = input.imageUrl != null
    ? { imageUrl: input.imageUrl, storyId: input.storyId, userId: input.userId }
    : await getGeneratedImageById(input.imageId);
  if (!image || image.storyId !== input.storyId || image.userId !== input.userId || !image.imageUrl)
    return { needsCopy: false, readable: false, error: FILM_STYLE_MISSING };
  if (isProviderPublicImageUrl(image.imageUrl)) return { needsCopy: false, readable: true };
  const source = await readOwnedImageBytes(image.imageUrl, input.userId);
  if (!source) return { needsCopy: true, readable: false, error: FILM_STYLE_UNREADABLE };
  return { needsCopy: true, readable: true };
}

/** Only a verified thumbnail or an already public image can cross the provider boundary. */
export async function hostFilmStyleImageUrl(input: {
  sourceUrl: string;
  userId: number;
  coverCopy?: { source: string; url: string };
}): Promise<string> {
  if (input.coverCopy?.source === input.sourceUrl) {
    if (!isProviderPublicImageUrl(input.coverCopy.url)) throw new Error(FILM_STYLE_HOST_FAILED);
    return input.coverCopy.url;
  }
  if (isProviderPublicImageUrl(input.sourceUrl)) return input.sourceUrl;
  const source = await readOwnedImageBytes(input.sourceUrl, input.userId);
  if (!source) throw new Error(FILM_STYLE_UNREADABLE);
  throw new Error("请先确认本轮发送画风参考的缩图，本次未提交生成。");
}

/** Resolve a separate --sref, never a primary image, context image or character anchor. */
export async function resolveFilmStyleReference(input: {
  body: Record<string, unknown>; storyId: number; userId: number;
  references?: ShotRenderReferences; hasExplicitStyle: boolean;
  coverCopy?: { source: string; url: string };
  prepareCopy?: (imageId: number) => Promise<{ source: string; url: string }>;
}) {
  if (input.hasExplicitStyle) return undefined;
  const recipe = activeArtSystemRecipe(input.body);
  const imageId = recipe?.system?.filmStyleImageId;
  const version = imageId ? recipe!.version : 0;
  if (input.references && (input.references.filmStyleVersion ?? 0) !== version)
    throw new Error(FILM_STYLE_STALE);
  if (!imageId) return undefined;
  const image = await getGeneratedImageById(imageId);
  if (!image || image.storyId !== input.storyId || image.userId !== input.userId || !image.imageUrl)
    throw new Error(FILM_STYLE_MISSING);
  let copy = input.coverCopy;
  if (!copy && needsProviderImageCopy(image.imageUrl) && input.references?.filmStyleCopyImageId === imageId)
    copy = await input.prepareCopy?.(imageId);
  return hostFilmStyleImageUrl({ sourceUrl: image.imageUrl, userId: input.userId, coverCopy: copy });
}
