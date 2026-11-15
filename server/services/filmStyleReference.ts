import { activeArtSystemRecipe } from "../../shared/artSystem";
import type { ShotRenderReferences } from "../../shared/shotImageRender";
import { getGeneratedImageById } from "../repositories/images";
import { materializeImageInput } from "./imageAssets";
import { wechatProviderReference } from "./wechatVideoImage";

/** Resolve a separate --sref, never a primary image, context image or character anchor. */
export async function resolveFilmStyleReference(input: {
  body: Record<string, unknown>; storyId: number; userId: number;
  references?: ShotRenderReferences; hasExplicitStyle: boolean;
}) {
  if (input.hasExplicitStyle) return undefined;
  const recipe = activeArtSystemRecipe(input.body);
  const imageId = recipe?.system?.filmStyleImageId;
  const version = imageId ? recipe!.version : 0;
  if (input.references && (input.references.filmStyleVersion ?? 0) !== version)
    throw new Error("全片画风参考已更新，请刷新后重新确认；本次未提交生成");
  if (!imageId) return undefined;
  const image = await getGeneratedImageById(imageId);
  if (!image || image.storyId !== input.storyId || image.userId !== input.userId || !image.imageUrl)
    throw new Error("全片画风参考图片已失效，请在对话中更换或停用；本次未提交生成");
  // Unlike optional legacy references, an unavailable explicitly chosen style must not be silently lost.
  try {
    await materializeImageInput(image.imageUrl, input.userId);
    return await wechatProviderReference(image.imageUrl, input.userId);
  } catch {
    throw new Error("全片画风参考图片无法读取，请在对话中更换或停用；本次未提交生成");
  }
}
