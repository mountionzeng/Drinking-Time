import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { generatedImages, stories } from "../../drizzle/schema";
import { readBookImage } from "../../shared/bookImageBlock";
import { writingModuleTexts } from "../../shared/bookWritingStyle";
import type { StoryChapter } from "../../drizzle/schema";
import { readChapterMedia } from "../chapterMediaStore";
import { ownsWechatImportImage } from "../repositories/wechatBookImport";
import {
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
  withLocalAggregateMutationLock,
} from "../repositories/runtime";

const wechatPath =
  /^\/api\/wechat-import\/media\/([a-f0-9]{64}\.(?:jpg|png|webp))$/;
export async function readOwnedWechatImage(
  url: string,
  userId: number
): Promise<Buffer | null> {
  const match = wechatPath.exec(url);
  if (!match || !Number.isSafeInteger(userId) || userId < 1) return null;
  const key = `chapters/${userId}/${match[1]}`;
  if (!(await ownsWechatImportImage(userId, key))) return null;
  const bytes = await readChapterMedia(key);
  return bytes &&
    createHash("sha256").update(bytes).digest("hex") === match[1].slice(0, 64)
    ? bytes
    : null;
}

/** Index only existing, verified private images when a user explicitly imports a storyboard. */
export async function indexWechatStoryboardImages(input: {
  storyId: number;
  userId: number;
  chapters: StoryChapter[];
}) {
  const urls = [
    ...new Set(
      input.chapters.flatMap(chapter =>
        writingModuleTexts(
          chapter.blocks.body,
          chapter.blocks.writingStyle
        ).flatMap(text => {
          const url = readBookImage(text)?.url;
          return url && wechatPath.test(url) ? [url] : [];
        })
      )
    ),
  ];
  for (const url of urls) {
    if (!(await readOwnedWechatImage(url, input.userId)))
      throw new Error("微信导入的图片无法读取，请检查原稿素材。");
  }
  if (!urls.length) return;
  const db = await getDb();
  if (db) {
    await db.transaction(async tx => {
      const owner = await tx
        .select({ id: stories.id })
        .from(stories)
        .where(
          and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
        )
        .for("update");
      if (!owner.length) throw new Error("故事不存在或无权访问");
      for (const url of urls) {
        const existing = await tx
          .select({ id: generatedImages.id })
          .from(generatedImages)
          .where(
            and(
              eq(generatedImages.storyId, input.storyId),
              eq(generatedImages.userId, input.userId),
              eq(generatedImages.imageUrl, url)
            )
          )
          .limit(1);
        if (!existing.length)
          await tx
            .insert(generatedImages)
            .values({
              storyId: input.storyId,
              userId: input.userId,
              imageUrl: url,
              isCurrent: false,
              generationType: "initial",
            });
      }
    });
    return;
  }
  await withLocalAggregateMutationLock(async () => {
    if (
      !memoryState.stories.some(
        s => s.id === input.storyId && s.userId === input.userId
      )
    )
      throw new Error("故事不存在或无权访问");
    const added: number[] = [];
    try {
      for (const url of urls) {
        if (
          memoryState.generatedImages.some(
            i =>
              i.storyId === input.storyId &&
              i.userId === input.userId &&
              i.imageUrl === url
          )
        )
          continue;
        const id = nextMemoryId("generatedImage");
        memoryState.generatedImages.push({
          id,
          storyId: input.storyId,
          userId: input.userId,
          imageUrl: url,
          projectId: null,
          shotNo: null,
          shotIdentity: null,
          imageKey: null,
          prompt: null,
          promptCompilationId: null,
          parentImageId: null,
          isCurrent: false,
          generationType: "initial",
          maskKey: null,
          createdAt: now(),
        });
        added.push(id);
      }
      if (added.length) await persistMemoryState();
    } catch (error) {
      memoryState.generatedImages = memoryState.generatedImages.filter(
        i => !added.includes(i.id)
      );
      throw error;
    }
  });
}
export const isWechatImportImage = (url: string) => wechatPath.test(url);
