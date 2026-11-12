import type { CreationEditorImage, CreationEditorShot } from "@/features/creationEditor/types";
import { storyboardShotFrameImages } from "./views/storyboardReviewModel";

export type ExplicitFrameRole = { imageId: number; role: "first" | "last" | "reference"; shotNo: number | null };

const CN: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/**
 * 「把图片 #2047 设为尾帧」「第 3 镜用 #2045 作为首帧」：按编号设帧角色（免费，只改镜头设定）。
 * 必须带图片编号、且整句只做这一件事；其他句子返回 null，照常走原流程。
 */
export function explicitImageFrameRole(text: string): ExplicitFrameRole | null {
  const value = text.trim().replace(/＃/g, "#").replace(/[。！!\s]+$/, "");
  const match = /^(?:请)?(?:把|将|用)?\s*(?:第\s*([\d一二两三四五六七八九十]{1,3})\s*镜(?:头)?\s*(?:的)?\s*[，,]?\s*(?:把|将|用)?\s*)?(?:图片|图像|图)?\s*#\s*(\d{1,7})\s*(?:设为|设置为|作为|用作|当作|当|做)\s*(?:第\s*([\d一二两三四五六七八九十]{1,3})\s*镜(?:头)?\s*的\s*)?(首帧|尾帧|参考帧|中间参考)$/.exec(value);
  if (!match) return null;
  const shotRaw = match[1] ?? match[3];
  const shotNo = shotRaw ? (/^\d+$/.test(shotRaw) ? Number(shotRaw) : CN[shotRaw] ?? null) : null;
  if (shotRaw && shotNo == null) return null;
  return { imageId: Number(match[2]), role: match[4] === "首帧" ? "first" : match[4] === "尾帧" ? "last" : "reference", shotNo };
}

/** 找到这张图所在的镜头和该镜可用的帧图；对不上就给出一句可直接回复的说明，不猜。 */
export function resolveExplicitFrameRole(
  request: ExplicitFrameRole,
  shots: readonly CreationEditorShot[],
  selectedShot?: CreationEditorShot
): { shot: CreationEditorShot; images: CreationEditorImage[] } | { error: string } {
  const owns = (shot: CreationEditorShot) => frameImages(shot, request.imageId).some(image => image.id === request.imageId);
  const shot = request.shotNo != null
    ? shots.find(item => item.shotNo === request.shotNo)
    : selectedShot && owns(selectedShot) ? selectedShot : shots.filter(owns).length === 1 ? shots.find(owns) : undefined;
  if (!shot) return { error: request.shotNo != null ? `找不到第 ${request.shotNo} 镜，帧设置没有改。` : `请写明镜号，例如「第 3 镜把图片 #${request.imageId} 设为尾帧」；帧设置没有改。` };
  const images = frameImages(shot, request.imageId);
  if (!images.some(image => image.id === request.imageId)) return { error: `图片 #${request.imageId} 还没有关联到第 ${shot.shotNo} 镜，帧设置没有改。` };
  return { shot, images };
}

/** 与「选中图片 → 设为首帧」一致：该镜的帧图，外加这张图本身是仅参考图的情况。 */
function frameImages(shot: CreationEditorShot, imageId: number): CreationEditorImage[] {
  const images = storyboardShotFrameImages(shot);
  const reference = shot.imageVersions?.find(image => image.id === imageId && image.referenceOnly);
  if (reference && !images.some(image => image.id === imageId)) images.push(reference);
  return images;
}
