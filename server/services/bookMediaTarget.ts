import { writingModuleTexts } from "../../shared/bookWritingStyle";
import { getChapter } from "../repositories/chapters";
import { getStoryById } from "../repositories/stories";
import { getGeneratedImageById } from "../repositories/images";
import { readBookImage } from "../../shared/bookImageBlock";

export type BookMediaTarget = {
  storyId: number;
  userId: number;
  imageId: number;
  chapterId: number;
  moduleId: string;
};
export async function bookMediaTargetIsCurrent(
  input: BookMediaTarget
): Promise<boolean> {
  const [story, chapter, image] = await Promise.all([
    getStoryById(input.storyId, input.userId),
    getChapter(input.chapterId, input.userId),
    getGeneratedImageById(input.imageId),
  ]);
  if (
    !story ||
    !chapter ||
    chapter.storyId !== input.storyId ||
    !image ||
    image.userId !== input.userId ||
    image.storyId !== input.storyId
  )
    return false;
  const index =
    chapter.blocks.writingStyle?.findIndex(
      block => block.id === input.moduleId
    ) ?? -1;
  if (index < 0) return false;
  const media = readBookImage(
    writingModuleTexts(chapter.blocks.body,chapter.blocks.writingStyle)[index] ?? ""
  );
  return Boolean(media && media.url === image.imageUrl);
}
