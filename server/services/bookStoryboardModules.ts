import { TRPCError } from "@trpc/server";
import { bookBlockNumbers, bookBlockNumberLabel } from "../../shared/bookBlockNumbering";
import { validWritingStyle } from "../../shared/bookWritingStyle";
import { readBookImage } from "../../shared/bookImageBlock";
import { readBookShotChapter, type BookShotChapter } from "../../shared/bookShotDocument";
import type { PublishingArticleLayout } from "../../shared/publishingArticleVideo";

type Image = {
  id: number;
  imageUrl: string;
  availability?: string | null;
  status?: string | null;
};

function invalid(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

/** Explicit module ownership takes precedence over title heuristics. No manuscript writes. */
export function bookStoryboardModules(
  chapters: BookShotChapter[],
  images: Image[]
): PublishingArticleLayout["bookScenes"] {
  if (!chapters.some(c => c.blocks.writingStyle?.some(r => r.format === "scene" || r.format === "shot"))) return;
  const result: NonNullable<PublishingArticleLayout["bookScenes"]> = [];
  for (const chapter of chapters) {
    const rows = chapter.blocks.writingStyle;
    if (!chapter.blocks.body.trim() && !rows?.some(r => r.format === "shot")) continue;
    if (!rows || !validWritingStyle(chapter.blocks.body, rows))
      invalid("镜头格式未完整保存，请先保存书稿再转视频。");
    const { shots, nodes, texts } = readBookShotChapter(chapter);
    if (!shots.length) invalid("请为该章节设置镜头后再转视频。");
    const occupiedScenes = new Set<string>();
    const parents = new Map(rows.map(row => [row.id, row.parentId]));
    for (const shot of shots) {
      let parent = parents.get(shot.moduleId);
      while (parent) {
        const ancestor = nodes.get(parent);
        if (ancestor?.shot) invalid("镜头不能嵌套在另一个镜头里。");
        if (ancestor?.scene) occupiedScenes.add(ancestor.scene);
        parent = parents.get(parent);
      }
    }
    rows.forEach((row, i) => {
      if (row.format === "scene" && chapter.blocks.storyboardScenes && !occupiedScenes.has(row.id))
        invalid("有场尚未包含镜头，请先在场内设置镜头再转视频。");
      if (!nodes.get(row.id)?.shot && (readBookImage(texts[i]) || (row.videoRole === "dialogue" && texts[i].trim())))
        invalid("镜头外还有图片或台词，请先移入对应镜头，避免转视频时错配素材。");
    });
    const numbers = bookBlockNumbers(rows, result.length);
    for (const shot of shots) {
      const referenceImageIds = shot.images.flatMap(image => {
        const asset = images.find(a => a.imageUrl === image.url && a.availability !== "missing" && a.status !== "rejected");
        return asset ? [asset.id] : [];
      });
      result.push({
        id: shot.id, sourceKind: "shot", sourceModuleIds: shot.sourceModuleIds,
        shotTitle: shot.title, productionNotes: shot.notes,
        text: shot.text || (chapter.blocks.storyboardScenes ? bookBlockNumberLabel(numbers.get(shot.moduleId)!) : `第 ${numbers.get(shot.moduleId)!.shotNumber} 镜`),
        dialogueText: shot.dialogueText, referenceImageIds: [...new Set(referenceImageIds)],
      });
    }
  }
  return result;
}
