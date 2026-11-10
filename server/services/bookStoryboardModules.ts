import { TRPCError } from "@trpc/server";
import {
  bookBlockNumbers,
  bookBlockNumberLabel,
} from "../../shared/bookBlockNumbering";
import {
  validWritingStyle,
  writingModuleTexts,
  type BookWritingStyle,
} from "../../shared/bookWritingStyle";
import { readBookImage } from "../../shared/bookImageBlock";
import { readBookAudio } from "../../shared/bookAudioBlock";
import type { PublishingArticleLayout } from "../../shared/publishingArticleVideo";

type Chapter = {
  id: number;
  blocks: { body: string; writingStyle?: BookWritingStyle };
};
type Image = {
  id: number;
  imageUrl: string;
  availability?: string | null;
  status?: string | null;
};

/** Explicit module ownership takes precedence over title heuristics. No manuscript writes. */
export function bookStoryboardModules(
  chapters: Chapter[],
  images: Image[]
): PublishingArticleLayout["bookScenes"] {
  if (
    !chapters.some(c =>
      c.blocks.writingStyle?.some(
        row => row.format === "scene" || row.format === "shot"
      )
    )
  )
    return;
  const fail = (message: string): never => {
    throw new TRPCError({ code: "BAD_REQUEST", message });
  };
  const result: NonNullable<PublishingArticleLayout["bookScenes"]> = [];
  for (const chapter of chapters) {
    if (
      !chapter.blocks.body.trim() &&
      !chapter.blocks.writingStyle?.some(r => r.format === "shot")
    )
      continue;
    const style = chapter.blocks.writingStyle;
    if (!style || !validWritingStyle(chapter.blocks.body, style))
      fail("场／镜头格式未完整保存，请先保存书稿再转视频。");
    const rows = style!;
    const texts = writingModuleTexts(chapter.blocks.body, rows);
    const byId = new Map(rows.map(row => [row.id, row]));
    const ancestors = (id: string) => {
      const path: BookWritingStyle = [];
      let parent = byId.get(id)?.parentId;
      while (parent) {
        const row = byId.get(parent)!;
        path.push(row);
        parent = row.parentId;
      }
      return path;
    };
    const shots = rows.filter(row => row.format === "shot");
    if (!shots.length)
      fail(
        "这份书稿包含场／镜头格式，请为每场及其他正文设置镜头后再转视频。旧幕式稿可继续使用章／节格式。"
      );
    const owners = rows.map(row =>
      row.format === "shot"
        ? row.id
        : ancestors(row.id).find(a => a.format === "shot")?.id
    );
    const scenes = rows.map(
      row => ancestors(row.id).find(a => a.format === "scene")?.id
    );
    for (const row of rows.filter(row => row.format === "scene")) {
      if (!shots.some(shot => ancestors(shot.id).some(a => a.id === row.id)))
        fail("有场尚未包含镜头，请先在场内设置镜头再转视频。");
    }
    rows.forEach((row, i) => {
      if (
        row.format === "shot" &&
        ancestors(row.id).some(a => a.format === "shot")
      )
        fail("镜头不能嵌套在另一个镜头里，请将它移到所属场后再转视频。");
      if (
        !owners[i] &&
        (readBookImage(texts[i]) ||
          (row.videoRole === "dialogue" && texts[i].trim()))
      )
        fail("镜头外还有图片或台词，请先移入对应镜头，避免转视频时错配素材。");
    });
    const numbers = bookBlockNumbers(rows);
    for (const shot of shots) {
      const shotIndex = rows.indexOf(shot),
        sceneId = scenes[shotIndex];
      const belongs = (i: number) => owners[i] === shot.id;
      const context = texts.filter(
        (text, i) =>
          !owners[i] &&
          !readBookImage(text) &&
          !readBookAudio(text) &&
          ((sceneId && (rows[i].id === sceneId || scenes[i] === sceneId)) ||
            (!scenes[i] && rows[i].format !== "scene"))
      );
      const content = texts.filter(
        (text, i) => belongs(i) && !readBookImage(text) && !readBookAudio(text)
      );
      const referenceImageIds = texts.flatMap((text, i) => {
        const image = belongs(i) && readBookImage(text);
        const asset =
          image &&
          images.find(
            a =>
              a.imageUrl === image.url &&
              a.availability !== "missing" &&
              a.status !== "rejected"
          );
        return asset ? [asset.id] : [];
      });
      result.push({
        id: `book-shot-${chapter.id}-${shot.id}`,
        sourceKind: "shot",
        sourceModuleIds: rows.filter((_, i) => belongs(i)).map(row => `${chapter.id}:${row.id}`),
        text:
          [...context, ...content].join("\n").trim() ||
          bookBlockNumberLabel(numbers.get(shot.id)!),
        // Empty means intentional silence: descriptions and titles never become speech.
        dialogueText: texts
          .filter((_, i) => belongs(i) && rows[i].videoRole === "dialogue")
          .join("\n"),
        referenceImageIds: [...new Set(referenceImageIds)],
      });
    }
  }
  return result;
}
