import { readBookAudio } from "./bookAudioBlock";
import { readBookImage } from "./bookImageBlock";
import { bookManuscriptModules, type BookShotChapter } from "./bookShotDocument";

type Chapter = Pick<BookShotChapter, "blocks">;
export function bookVideoImportReview(storyId: number, chapters: Chapter[]) {
  const images = new Set<string>();
  const audio = new Map<number, NonNullable<ReturnType<typeof readBookAudio>>>();
  const dialogue: string[] = [];
  let shots = 0;
  for (const { blocks } of chapters) {
    bookManuscriptModules(blocks).forEach(module => {
      if (module.row?.format === "shot") shots++;
      if (module.dialogue?.trim()) dialogue.push(module.dialogue.trim());
      if (module.image) images.add(module.image.url);
      if (module.audio?.storyId === storyId) audio.set(module.audio.assetId, module.audio);
      // Older unstructured paragraphs can contain an inline media line.
      if (!module.text.includes("\n")) return;
      for (const line of module.text.split("\n")) {
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
