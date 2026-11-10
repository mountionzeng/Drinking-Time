import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  bookWritingStyleSchema,
  validWritingStyle,
  writingModuleTexts,
  type BookWritingStyle,
} from "../../shared/bookWritingStyle";
import type { StoredChapterBlocks } from "../../shared/chapterStore";
import { readBookImage } from "../../shared/bookImageBlock";
import { readBookAudio } from "../../shared/bookAudioBlock";
import { getStoryById } from "../repositories/stories";
import { listChapters } from "../repositories/chapters";
import { saveBookStoryboard } from "../repositories/bookStoryboard";
import { getStoryImageAssets } from "./imageAssets";
import { bookStoryboardModules } from "./bookStoryboardModules";
import { runPublishingVideoStoryboardTextCompute } from "./publishingVideoStoryboard";

const title = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine(text => !text.includes("\n"));
export const manuscriptPlanSchema = z.object({
  scenes: z
    .array(
      z.object({
        title,
        shots: z
          .array(
            z.object({
              title,
              units: z.array(z.number().int().nonnegative()).min(1),
              dialogueModuleIds: z.array(z.string()).optional(),
            })
          )
          .min(1),
      })
    )
    .min(1),
});
type Plan = z.infer<typeof manuscriptPlanSchema>;
const stableId = (text: string) =>
  `board-${createHash("sha256").update(text).digest("hex").slice(0, 24)}`;

/** Preserve complete existing trees and side-by-side pairs as indivisible planning units. */
export function storyboardSourceUnits(
  chapterId: number,
  blocks: StoredChapterBlocks
) {
  const texts = writingModuleTexts(blocks.body, blocks.writingStyle);
  if (
    blocks.writingStyle &&
    !validWritingStyle(blocks.body, blocks.writingStyle)
  )
    throw new Error("书稿模块格式未完整保存，请先保存后再整理。");
  const rows: BookWritingStyle =
    blocks.writingStyle ??
    texts.map((_, i) => ({
      id: stableId(`${chapterId}:source:${i}`),
      format: "text",
      parentId: null,
      collapsed: false,
    }));
  const units: Array<{
    rows: BookWritingStyle;
    texts: string[];
    blockIds: string[];
  }> = [];
  let lineIndex = 0;
  rows.forEach((row, i) => {
    const count = texts[i].split("\n").filter(line => line.trim()).length;
    const blockIds = Array.from(
      { length: count },
      (_, index) =>
        blocks.blockIds[lineIndex + index] ??
        stableId(`${chapterId}:line:${lineIndex + index}`)
    );
    lineIndex += count;
    const last = units.at(-1);
    if (
      row.parentId === null &&
      !(row.columnGroup && last?.rows[0].columnGroup === row.columnGroup)
    )
      units.push({ rows: [row], texts: [texts[i]], blockIds });
    else {
      if (!last) throw new Error("书稿层级不完整");
      last.rows.push(row);
      last.texts.push(texts[i]);
      last.blockIds.push(...blockIds);
    }
  });
  return units;
}

export function applyStoryboardPlan(
  chapterId: number,
  blocks: StoredChapterBlocks,
  plan: Plan
): StoredChapterBlocks {
  const units = storyboardSourceUnits(chapterId, blocks),
    order = plan.scenes.flatMap(scene =>
      scene.shots.flatMap(shot => shot.units)
    );
  if (order.length !== units.length || order.some((id, i) => id !== i))
    throw new Error("分镜整理没有完整保留原模块顺序，原稿未修改，请重新整理。");
  const rows: BookWritingStyle = [],
    texts: string[] = [],
    blockIds: string[] = [];
  const classified = blocks.writingStyle?.some(
    row => row.videoRole === "dialogue"
  );
  const add = (
    id: string,
    text: string,
    format: "scene" | "shot",
    parentId: string | null
  ) => {
    rows.push({ id, format, parentId, collapsed: format === 'shot' });
    texts.push(text);
    blockIds.push(id);
  };
  for (const scene of plan.scenes) {
    const sceneId = stableId(
      `${chapterId}:scene:${units[scene.shots[0].units[0]].rows[0].id}`
    );
    add(sceneId, scene.title, "scene", null);
    for (const shot of scene.shots) {
      const shotId = stableId(
        `${chapterId}:shot:${units[shot.units[0]].rows[0].id}`
      );
      add(shotId, shot.title, "shot", sceneId);
      const dialogue = new Set(shot.dialogueModuleIds ?? []);
      for (const id of dialogue) {
        if (
          !shot.units.some(index =>
            units[index].rows.some(
              (row, i) =>
                row.id === id &&
                row.format === "text" &&
                units[index].texts[i].trim() &&
                !readBookImage(units[index].texts[i]) &&
                !readBookAudio(units[index].texts[i])
            )
          )
        )
          throw new Error("台词分类包含非文字或未知模块，原稿未修改。");
      }
      for (const index of shot.units) {
        const unit = units[index];
        rows.push(
          ...unit.rows.map(row => ({
            ...row,
            parentId: row.parentId ?? shotId,
            collapsed: false,
            ...(!classified && dialogue.has(row.id)
              ? { videoRole: "dialogue" as const }
              : {}),
          }))
        );
        texts.push(...unit.texts);
        blockIds.push(...unit.blockIds);
      }
    }
  }
  const body = texts.join("\n");
  if (
    body.length > 200_000 ||
    !bookWritingStyleSchema.safeParse(rows).success ||
    !validWritingStyle(body, rows)
  )
    throw new Error("分镜稿结构超出范围，原稿未修改。");
  return {
    ...blocks,
    body,
    blockIds,
    writingStyle: rows,
    containsAiText: true,
  };
}

export async function prepareBookStoryboard(input: {
  storyId: number;
  userId: number;
  request: string;
}) {
  if (!(await getStoryById(input.storyId, input.userId)))
    throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
  const chapters = await listChapters(input.storyId, input.userId);
  if (!chapters.length) return { chapters: [], shotCount: 0, changed: false };
  if (
    chapters.reduce((size, chapter) => size + chapter.blocks.body.length, 0) >
    100_000
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "本次分镜稿超出文字长度范围，原稿未修改，请先缩小故事范围。",
    });
  const updates: Array<{ id: number; blocks: StoredChapterBlocks }> = [];
  for (const chapter of chapters) {
    const inline = new Set(
      writingModuleTexts(
        chapter.blocks.body,
        chapter.blocks.writingStyle
      ).flatMap(text => {
        const image = readBookImage(text);
        return image ? [image.url] : [];
      })
    );
    if (
      chapter.layout?.pages.some(page =>
        page.modules.some(
          module => module.kind === "image" && !inline.has(module.imageUrl)
        )
      )
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "旧排版还有独立图片，请先将它们插入书页对应位置，再整理分镜稿。原稿和图片均保留。",
      });
    if (
      chapter.blocks.writingStyle?.some(
        row => row.format === "scene" || row.format === "shot"
      ) ||
      !chapter.blocks.body.trim()
    )
      continue;
    const units = storyboardSourceUnits(chapter.id, chapter.blocks);
    const result = await runPublishingVideoStoryboardTextCompute({
      systemPrompt:
        "你是分镜稿整理员。只输出JSON {scenes:[{title,shots:[{title,units:[0,1],dialogueModuleIds:[]}]}]}。按故事时间顺序将全部units分组为场和镜头。units展平必须精确等于0到末尾，每项一次，不能重排、遗漏、拆分或改写。每组图片属于同一镜头，不将图片各拆一镜。已有第N幕或章节边界优先。标题简短，不含序号。不生成新台词、人物或动作。若已有任意videoRole标记，保留这些分类；否则根据用途选择适合原样朗读的正文/角色台词模块ID放入dialogueModuleIds供用户核对，画面描述、音乐要求、标题与媒体不得朗读。原文/媒体内容完全由系统保留。",
      context: {
        request: input.request,
        chapterTitle: chapter.title,
        units: units.map((unit, index) => ({
          index,
          modules: unit.texts.map((text, i) => ({
            id: unit.rows[i].id,
            text,
            format: unit.rows[i].format,
            videoRole: unit.rows[i].videoRole,
          })),
        })),
      },
      maxTokens: 6000,
    });
    const plan = manuscriptPlanSchema.safeParse(result.parsed);
    if (!plan.success)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "分镜整理结果不完整，原稿未修改，请稍后重试。",
      });
    updates.push({
      id: chapter.id,
      blocks: applyStoryboardPlan(chapter.id, chapter.blocks, plan.data),
    });
  }
  const prepared = chapters.map(chapter => ({
    ...chapter,
    blocks:
      updates.find(update => update.id === chapter.id)?.blocks ??
      chapter.blocks,
  }));
  const shots = bookStoryboardModules(
    prepared,
    await getStoryImageAssets(input.storyId, input.userId)
  );
  if (
    (shots?.length ?? 0) > 100 ||
    prepared.reduce((size, chapter) => size + chapter.blocks.body.length, 0) >
      100_000
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "本次分镜稿超出100镜或文字长度范围，原稿未修改，请先缩小故事范围。",
    });
  const saved = updates.length
    ? await saveBookStoryboard({
        ...input,
        expected: chapters.map(({ id, version }) => ({ id, version })),
        updates,
      })
    : [];
  return {
    chapters: chapters.map(
      ({ id, version }) =>
        saved.find(chapter => chapter.id === id) ?? { id, version }
    ),
    shotCount: shots?.length ?? 0,
    changed: Boolean(saved.length),
  };
}
