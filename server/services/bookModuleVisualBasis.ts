import { useSeparateFilmStyle, type BookRenderReference } from "../../shared/bookRenderReference";
import { needsProviderImageCopy } from "../../shared/providerImageUrl";
import { readBookShotChapter } from "../../shared/bookShotDocument";
import { readPreviewResults } from "./artPreview";
import { confirmedShotScene, shotSceneFacts } from "../../shared/shotSceneDirection";
import { activeArtSystemRecipe } from "../../shared/artSystem";
import { creationFingerprint, creationRecord, ownedCreationStory } from "../repositories/textSourceLineage";
import { getChapter } from "../repositories/chapters";
import { getGeneratedImageById } from "../repositories/images";
import { getStoryMaterialState } from "./storyMaterials";
import { previewArtBasis } from "./previewArtBasis";
import { FILM_STYLE_UNREADABLE, hostFilmStyleImageUrl, inspectFilmStyleImage } from "./filmStyleReference";
import { bookRoundRatio, isBookImageRatio, squareBookImage, supportsBookGptRatio, type BookImageRatio } from "../../shared/bookImageFrame";
import { bookProductionChapters } from "../../shared/bookShotFormat";
import { manuscriptRows } from "../repositories/bookWorkflow";
import { listChapters } from "../repositories/chapters";
import { updateStoryBodyIfRevision } from "../repositories/stories";
import { relatedBookPictures } from "./bookPictureRelations";
import { bookPictureLookup } from "./bookPictureVersions";
import { openPreviewCoverCopy, preparePreviewCoverCopy } from "./previewCoverCopy";

type Scope = { storyId: number; userId: number; chapterId: number; moduleId: string };

export async function setBookImageFrame(input: Pick<Scope,"storyId"|"userId"> & {
  ratio: BookImageRatio; shotNo?: number; chapterId?: number; moduleId?: string;
}) {
  let key = "default";
  if (input.shotNo || input.moduleId) {
    const chapters = await listChapters(input.storyId, input.userId, "all");
    const active = chapters.find(c => c.id === input.chapterId);
    if (!active || active.blocks.manuscriptArchived) throw new Error("请打开要改画幅的分镜版，再指定镜号。");
    const rows = manuscriptRows(chapters, active.blocks.manuscriptKind ?? "storyboard");
    const ordered = bookProductionChapters(rows, active.id).flatMap(c => readBookShotChapter(c).shots);
    const target = input.shotNo ? ordered[input.shotNo - (active.blocks.shotTextOrigin?.shotNo ?? 1)] :
      ordered.find(s => s.sourceModuleIds.includes(active.id + ":" + input.moduleId));
    if (!target) throw new Error("请指定当前分镜版中已有的镜号。");
    key = target.chapterId + ":" + target.moduleId;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const { body, revision } = await ownedCreationStory(input);
    const previous = creationRecord(body.bookImageFrames);
    if (previous[key] === input.ratio) return input.ratio;
    if (await updateStoryBodyIfRevision({ id: input.storyId, userId: input.userId, expectedRevision: revision,
      body: { ...body, bookImageFrames: { ...previous, [key]: input.ratio }, _revision: revision + 1 } })) return input.ratio;
  }
  throw new Error("书稿正在同步，请稍后再改画幅。");
}

export async function bookModuleVisualBasis(scope: Scope) {
  const { story, body } = await ownedCreationStory(scope);
  const allShots = Array.isArray(body.shots) ? body.shots.map(creationRecord) : [];
  const linked = (moduleId: string) => allShots.filter(shot => {
    const key = `${scope.chapterId}:${moduleId}`;
    const ids = creationRecord(shot.publishingVideo).sourceModuleIds;
    return Array.isArray(ids) && ids.includes(key);
  });
  const chapter = await getChapter(scope.chapterId, scope.userId);
  if (chapter?.storyId !== scope.storyId || !chapter.blocks.writingStyle?.some(b => b.id === scope.moduleId))
    throw new Error("书稿模块已变化，请重新选择");
  const document = readBookShotChapter(chapter);
  const bookShot = document.nodes.get(scope.moduleId)?.shot;
  const settings = creationRecord(body.bookImageFrames);
  const preference = (bookShot && settings[scope.chapterId + ":" + bookShot]) || settings.default;
  let shots = linked(scope.moduleId);
  if (!shots.length && bookShot) shots = linked(bookShot);
  const film = activeArtSystemRecipe(body);
  // Linkage supplies video-only staging. The manuscript already belongs to the film before import.
  if (!bookShot && !shots.length && !film && !isBookImageRatio(preference)) return null;
  const material = await getStoryMaterialState(scope.storyId, scope.userId);
  if (!material) throw new Error("无法读取本片画幅，请稍后重试");
  const art = previewArtBasis(body, material, story.title);
  const styleImageId = film?.system?.filmStyleImageId ?? art.coverImageId;
  const ref = styleImageId ? await getGeneratedImageById(styleImageId) : null;
  if (styleImageId && (!ref || ref.storyId !== scope.storyId || ref.userId !== scope.userId || !ref.imageUrl))
    throw new Error("本片的画风参考已失效，请重新选择");
  const inspection = ref ? await inspectFilmStyleImage({
    storyId: scope.storyId, userId: scope.userId, imageId: styleImageId, imageUrl: ref.imageUrl,
  }) : { needsCopy: false, readable: true as const };
  if (ref && !inspection.readable) throw new Error(inspection.error ?? FILM_STYLE_UNREADABLE);
  const notes = shots.length === 1 ? [shots[0].colorPalette, shots[0].materialTexture, shots[0].lighting].filter(v => typeof v === "string" && v).join("；") : "";
  const ownedImages = (material.warehouseImages ?? []).filter(i => i.storyId === scope.storyId && i.userId === scope.userId);
  const artImageIds = film?.system?.referenceImageIds ?? [];
  const pictures = bookShot && (document.shots.some(s => s.images.length) || artImageIds.length) ? await bookPictureLookup(scope.userId, scope.storyId) : null;
  const pageShots = pictures ? document.shots.map(s => ({ ...s, images: s.images.map(i => ({ ...i, url: pictures.urls.get(i.url) ?? i.url })) })) : document.shots;
  const characters = Array.isArray(body.characters) ? body.characters.map(c => creationRecord(c).name)
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0) : [];
  const content = relatedBookPictures(pageShots, bookShot, ownedImages, linked, styleImageId, characters);
  const swatches = [...new Set(artImageIds.map(id => pictures?.byId.get(id)?.id ?? id))].flatMap(id => {
    const image = ownedImages.find(a => a.id === id && a.status !== "rejected" && a.availability !== "missing");
    if (!image || id === styleImageId || content.some(p => p.imageId === id)) return [];
    return [{ kind: "style" as const, imageId: id, imageUrl: image.imageUrl, sourceTitle: "全片美术参考",
      use: "笔触、材质和色块，不沿用内容、文字或边框", needsCopy: needsProviderImageCopy(image.imageUrl) }];
  });
  const relatedPictures = [...content, ...swatches].slice(0, 3);
  const basis = {
    shotNumbers: shots.map(s => Number(s.shotNo)),
    aspectRatio: isBookImageRatio(preference) ? preference : squareBookImage, relatedPictures,
    styleName: art.styleName, styleImageId, coverImageId: art.coverImageId,
    direction: [...new Set([art.direction, art.rules, notes].flatMap(value =>
      value?.split("\n").map(line => line.trim()).filter(Boolean) ?? []))].join("\n"),
    needsCopy: Boolean(ref && needsProviderImageCopy(ref.imageUrl)),
  };
  const one = shots.length === 1 ? shots[0] : null;
  const sceneFacts = one ? shotSceneFacts(body, one) : "";
  const confirmedScene = !!one && Boolean(confirmedShotScene(body, one));
  const fingerprint = creationFingerprint({ storyId: scope.storyId, userId: scope.userId, chapterId: scope.chapterId, moduleId: scope.moduleId,
    basis, ...(sceneFacts ? { sceneFacts, confirmedScene } : {}), shotIds: shots.map(s => s.stableShotId), styleUrl: ref?.imageUrl ?? null });
  const latest = shots.length === 1 ? readPreviewResults(body).reverse().flatMap(batch =>
    batch.shots.filter(s => s.stableShotId === shots[0].stableShotId && s.status === "succeeded" && s.candidates.length)
      .map(s => ({ version: batch.version, candidates: s.candidates }))).at(0) : undefined;
  const previewImages = latest?.candidates.flatMap(c => {
    const image = ownedImages.find(i => i.id === c.imageId && i.availability !== "missing" && i.status !== "rejected");
    return image ? [{ imageId: image.id, imageUrl: image.imageUrl }] : [];
  }) ?? [];
  return { ...basis, stableShotId: one ? String(one.stableShotId || "") : "", sceneFacts, confirmedScene, fingerprint, previewVersion: latest?.version, previewImages };
}

export async function bookModuleRenderStyle(scope: Scope, options: { requestId: string; basisHash?: string; copyImageId?: number; allowPublicHosting?: boolean; relatedImageIds?: number[]; adjustment?: string; gpt?: boolean; reference?: Pick<BookRenderReference, "use" | "imageId"> }) {
  const basis = await bookModuleVisualBasis(scope);
  if ((basis?.fingerprint ?? undefined) !== options.basisHash)
    throw new Error("本镜画幅或画风已变化，请重新打开窗口确认后再生成。");
  const ids = options.relatedImageIds ?? [];
  const selected = basis?.relatedPictures.filter(p => ids.includes(p.imageId) && p.imageId !== options.reference?.imageId && (p.kind !== "style" || useSeparateFilmStyle(options.reference, basis.styleImageId))) ?? [];
  if (selected.length !== ids.length) throw new Error("镜头参考图已变化，请重新核对。");
  const aspectRatio = bookRoundRatio(options.adjustment) ?? basis?.aspectRatio ?? squareBookImage;
  if (options.gpt && !supportsBookGptRatio(aspectRatio)) throw new Error("GPT 图片支持 1:1、3:2 和 2:3，可在转换要求里指定比例或选择 MJ。");
  if (!basis) return null;
  let styleRef: string | undefined;
  let coverCopy: { source: string; url: string } | undefined;
  if (basis.styleImageId && useSeparateFilmStyle(options.reference, basis.styleImageId)) {
    const image = await getGeneratedImageById(basis.styleImageId);
    if (!image || image.userId !== scope.userId || image.storyId !== scope.storyId || !image.imageUrl) throw new Error("画风参考已失效");
    if (basis.needsCopy) {
      if (options.copyImageId !== basis.styleImageId) throw new Error("请先确认本轮发送画风参考的缩图");
      const copyScope = { ...scope, allowPublicHosting: options.allowPublicHosting, imageId: image.id, roundId: options.requestId };
      coverCopy = await openPreviewCoverCopy(await preparePreviewCoverCopy(copyScope, image.imageUrl), copyScope);
    }
    styleRef = await hostFilmStyleImageUrl({ sourceUrl: image.imageUrl, userId: scope.userId, coverCopy });
  }
  const related = await Promise.all(selected.map(async p => {
    const source = { ...scope, imageId: p.imageId, roundId: options.requestId };
    const url = p.needsCopy ? (await openPreviewCoverCopy(await preparePreviewCoverCopy(source, p.imageUrl), source)).url : p.imageUrl;
    return { kind: p.kind, use: p.use, url };
  }));
  return { aspectRatio, related, direction: basis.direction, styleImageId: basis.styleImageId, styleRef, coverCopy, sceneFacts: basis.sceneFacts, confirmedScene: basis.confirmedScene, stableShotId: basis.stableShotId };
}
