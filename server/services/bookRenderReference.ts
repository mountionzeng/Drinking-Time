import { readBookShotChapter } from "../../shared/bookShotDocument";
import { bookProductionChapters } from "../../shared/bookShotFormat";
import { readBookImage } from "../../shared/bookImageBlock";
import type { BookReferenceSource, BookRenderReference } from "../../shared/bookRenderReference";
import { needsProviderImageCopy } from "../../shared/providerImageUrl";
import { manuscriptRows } from "../repositories/bookWorkflow";
import { listChapters } from "../repositories/chapters";
import { moduleImageTasks } from "../repositories/bookModuleImageTasks";
import { getImageTaskStore } from "../repositories/imageGenerationTasks";
import { creationFingerprint, creationRecord, ownedCreationStory } from "../repositories/textSourceLineage";
import { getStoryImageAssets } from "./imageAssets";
import { imageTaskAsyncSubmitEnabled } from "./imageGenerationTaskWorker";
import { openPreviewCoverCopy, preparePreviewCoverCopy } from "./previewCoverCopy";

type Scope = { userId: number; storyId: number; chapterId: number; moduleId: string };

/** Resolve the book's displayed shot numbers in the active manuscript, including one-shot working copies. */
export async function locateBookRenderReference(scope: Scope, source: BookReferenceSource) {
  const { body } = await ownedCreationStory(scope);
  const all = await listChapters(scope.storyId, scope.userId, "all");
  const active = all.find(c => c.id === scope.chapterId);
  if (!active?.blocks.writingStyle?.some(m => m.id === scope.moduleId)) throw new Error("书页模块已变化，请重新打开窗口。");
  const text = manuscriptRows(all, "text");
  const chapters = bookProductionChapters(text.some(c => c.id === active.id) ? text : manuscriptRows(all, "storyboard"), active.id);
  let number = Math.max(0, (active.blocks.shotTextOrigin?.shotNo ?? 1) - 1);
  const rows = chapters.flatMap(chapter => {
    const doc = readBookShotChapter(chapter);
    const numbers = new Map(doc.shots.map(s => [s.moduleId, ++number]));
    return (chapter.blocks.writingStyle ?? []).map((row, i) => {
      const owner = doc.nodes.get(row.id)?.shot;
      return { chapterId: chapter.id, moduleId: row.id, shotNo: owner ? numbers.get(owner) : undefined,
        url: readBookImage(doc.texts[i] ?? "")?.url };
    });
  });
  const index = rows.findIndex(r => r.chapterId === scope.chapterId && r.moduleId === scope.moduleId);
  if (index < 0) throw new Error("找不到当前书页，请重新打开窗口。");
  const nearest = source === "above" ? rows.slice(0, index).reverse().find(r => r.url) : undefined;
  const shotNo = source === "above" ? nearest?.shotNo : source === "previous" ? (rows[index].shotNo ?? 0) - 1 : source;
  const target = source === "above" ? nearest ? [nearest] : [] : rows.filter(r => shotNo && r.shotNo === shotNo);
  if (!target.length) return [];
  const assets = (await getStoryImageAssets(scope.storyId, scope.userId)).filter(a =>
    a.storyId === scope.storyId && a.userId === scope.userId && a.availability !== "missing" && a.status !== "rejected");
  const pageUrls = new Set(target.flatMap(r => r.url ? [r.url] : []));
  let matches = assets.filter(a => pageUrls.has(a.imageUrl));
  let kind: "page" | "selected" | "candidate" = "page";
  if (!pageUrls.size && source !== "above") {
    const keys = new Set(target.map(r => r.chapterId + ":" + r.moduleId));
    const shotIds = new Set((Array.isArray(body.shots) ? body.shots : []).map(creationRecord).filter(s => {
      const ids = creationRecord(s.publishingVideo).sourceModuleIds;
      return Array.isArray(ids) && ids.some(id => keys.has(id));
    }).map(s => s.stableShotId).filter((id): id is string => typeof id === "string"));
    const linked = assets.filter(a => (a.shotIdentity && shotIds.has(a.shotIdentity)) || a.libraryShotIds?.some(id => shotIds.has(id)));
    matches = linked.filter(a => a.selectionSource === "explicit" && a.isPrimary);
    kind = "selected";
    if (!matches.length) {
      const legacy = moduleImageTasks(body).filter(t => keys.has(t.chapterId + ":" + t.moduleId));
      const store = imageTaskAsyncSubmitEnabled() ? await getImageTaskStore() : null;
      const stored = store ? (await Promise.all(target.map(r => store.listForModule(scope.userId, scope.storyId, r.chapterId, r.moduleId)))).flat() : [];
      const ids = new Set([...legacy, ...stored].filter(t => t.status === "succeeded").flatMap(t => t.candidates?.map(c => c.imageId) ?? []));
      matches = assets.filter(a => ids.has(a.id) || linked.includes(a));
      kind = "candidate";
    }
  }
  return matches.map(a => ({ imageId: a.id, imageUrl: a.imageUrl, shotNo, kind, needsCopy: needsProviderImageCopy(a.imageUrl),
    fingerprint: creationFingerprint([scope.userId, scope.storyId, scope.chapterId, scope.moduleId, source, shotNo, kind,
      target.map(r => [r.chapterId, r.moduleId, r.url]), a.id, a.imageUrl, a.imageKey]) }));
}

export async function resolveBookRenderReference(scope: Scope, selection: BookRenderReference, roundId: string) {
  const choices = await locateBookRenderReference(scope, selection.source);
  const selected = choices.find(c => c.imageId === selection.imageId && c.fingerprint === selection.fingerprint);
  if (!selected) throw new Error("参考镜头或图片已变化，请重新定位。本次未提交生成。");
  if (!selected.needsCopy) return selected.imageUrl;
  if (!selection.sendThumbnail) throw new Error("请先确认本轮发送镜头参考缩图。本次未提交生成。");
  const copyScope = { ...scope, allowPublicHosting: selection.allowPublicHosting, imageId: selected.imageId, roundId };
  const copy = await openPreviewCoverCopy(await preparePreviewCoverCopy(copyScope, selected.imageUrl), copyScope);
  if (copy.source !== selected.imageUrl) throw new Error("参考图片已变化，请重新定位。本次未提交生成。");
  return copy.url;
}
