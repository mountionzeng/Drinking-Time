import { readBookAudio } from "./bookAudioBlock";
import { readBookImage } from "./bookImageBlock";
import { writingModuleTexts, type BookWritingStyle } from "./bookWritingStyle";

type Chapter = { blocks: { body: string; writingStyle?: BookWritingStyle } };
export function bookVideoImportReview(storyId: number, chapters: Chapter[]) {
  const images = new Set<string>();
  const audio = new Map<number, NonNullable<ReturnType<typeof readBookAudio>>>();
  const dialogue: string[] = [];
  let shots = 0;
  for (const { blocks } of chapters) {
    writingModuleTexts(blocks.body, blocks.writingStyle).forEach((text, index) => {
      const style = blocks.writingStyle?.[index];
      if (style?.format === "shot") shots++;
      if (style?.videoRole === "dialogue" && text.trim()) dialogue.push(text.trim());
      for (const line of text.split("\n")) {
        const image = readBookImage(line.trim());
        if (image) images.add(image.url);
        const clip = readBookAudio(line.trim());
        if (clip?.storyId === storyId) audio.set(clip.assetId, clip);
      }
    });
  }
  return { shots, images: [...images], audio: [...audio.values()], dialogue };
}
export type BookVideoImportReview = ReturnType<typeof bookVideoImportReview>;
