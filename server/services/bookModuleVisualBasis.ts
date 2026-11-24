import { readPreviewResults } from "./artPreview";
import { confirmedShotScene, shotSceneFacts } from "../../shared/shotSceneDirection";
import { activeArtSystemRecipe } from "../../shared/artSystem";
import { creationFingerprint, creationRecord, ownedCreationStory } from "../repositories/textSourceLineage";
import { getChapter } from "../repositories/chapters";
import { getGeneratedImageById } from "../repositories/images";
import { getStoryMaterialState } from "./storyMaterials";
import { previewArtBasis } from "./previewArtBasis";
import { resolveVideoExportAspectRatio } from "./videoExport";
import { isWechatImportImage, privateReferenceOrigin, wechatProviderReference } from "./wechatVideoImage";
import { openPreviewCoverCopy, preparePreviewCoverCopy } from "./previewCoverCopy";

type Scope = { storyId: number; userId: number; chapterId: number; moduleId: string };

export async function bookModuleVisualBasis(scope: Scope) {
  const { story, body } = await ownedCreationStory(scope);
  const key = `${scope.chapterId}:${scope.moduleId}`;
  const shots = (Array.isArray(body.shots) ? body.shots.map(creationRecord) : []).filter(shot => {
    const ids = creationRecord(shot.publishingVideo).sourceModuleIds;
    return Array.isArray(ids) && ids.includes(key);
  });
  if (!shots.length) return null; // Standalone book illustrations retain their existing format.
  const chapter = await getChapter(scope.chapterId, scope.userId);
  if (chapter?.storyId !== scope.storyId || !chapter.blocks.writingStyle?.some(b => b.id === scope.moduleId))
    throw new Error("书稿模块已变化，请重新选择");
  const material = await getStoryMaterialState(scope.storyId, scope.userId);
  if (!material) throw new Error("无法读取本片画幅，请稍后重试");
  const art = previewArtBasis(body, material, story.title);
  const film = activeArtSystemRecipe(body);
  const styleImageId = film?.system?.filmStyleImageId ?? art.coverImageId;
  const ref = styleImageId ? await getGeneratedImageById(styleImageId) : null;
  if (styleImageId && (!ref || ref.storyId !== scope.storyId || ref.userId !== scope.userId || !ref.imageUrl))
    throw new Error("本片的画风参考已失效，请重新选择");
  const notes = shots.length === 1 ? [shots[0].colorPalette, shots[0].materialTexture, shots[0].lighting].filter(v => typeof v === "string" && v).join("；") : "";
  const basis = {
    shotNumbers: shots.map(s => Number(s.shotNo)),
    aspectRatio: resolveVideoExportAspectRatio(material),
    styleName: art.styleName, styleImageId, coverImageId: art.coverImageId,
    direction: [art.direction, art.rules, notes].filter(Boolean).join("\n"),
    needsCopy: Boolean(ref && isWechatImportImage(ref.imageUrl) && !privateReferenceOrigin()),
  };
  const one = shots.length === 1 ? shots[0] : null;
  const sceneFacts = one ? shotSceneFacts(body, one) : "";
  const confirmedScene = !!one && Boolean(confirmedShotScene(body, one));
  const fingerprint = creationFingerprint({ storyId: scope.storyId, userId: scope.userId, chapterId: scope.chapterId, moduleId: scope.moduleId,
    basis, ...(sceneFacts ? { sceneFacts, confirmedScene } : {}), shotIds: shots.map(s => s.stableShotId), styleUrl: ref?.imageUrl ?? null });
  const latest = shots.length === 1 ? readPreviewResults(body).reverse().flatMap(batch =>
    batch.shots.filter(s => s.stableShotId === shots[0].stableShotId && s.status === "succeeded" && s.candidates.length)
      .map(s => ({ version: batch.version, candidates: s.candidates }))).at(0) : undefined;
  const ownedImages = material.warehouseImages ?? [];
  const previewImages = latest?.candidates.flatMap(c => {
    const image = ownedImages.find(i => i.id === c.imageId && i.availability !== "missing" && i.status !== "rejected");
    return image ? [{ imageId: image.id, imageUrl: image.imageUrl }] : [];
  }) ?? [];
  return { ...basis, stableShotId: one ? String(one.stableShotId || "") : "", sceneFacts, confirmedScene, fingerprint, previewVersion: latest?.version, previewImages };
}

export async function bookModuleRenderStyle(scope: Scope, options: { requestId: string; basisHash?: string; copyImageId?: number }) {
  const basis = await bookModuleVisualBasis(scope);
  if ((basis?.fingerprint ?? undefined) !== options.basisHash)
    throw new Error("本镜画幅或画风已变化，请重新打开窗口确认后再生成。");
  if (!basis) return null;
  let styleRef: string | undefined;
  if (basis.styleImageId) {
    const image = await getGeneratedImageById(basis.styleImageId);
    if (!image || image.userId !== scope.userId || image.storyId !== scope.storyId) throw new Error("画风参考已失效");
    if (basis.needsCopy) {
      if (options.copyImageId !== image.id) throw new Error("请先确认本轮发送画风参考的缩图");
      const copyScope = { ...scope, imageId: image.id, roundId: options.requestId };
      const copy = await openPreviewCoverCopy(await preparePreviewCoverCopy(copyScope), copyScope);
      styleRef = copy.url;
    } else styleRef = await wechatProviderReference(image.imageUrl, scope.userId);
  }
  return { aspectRatio: basis.aspectRatio, direction: basis.direction, styleRef, sceneFacts: basis.sceneFacts, confirmedScene: basis.confirmedScene };
}
