import { z } from "zod";
import { writingModuleTexts, type BookWritingStyle } from "./bookWritingStyle";
import { readBookAudio } from "./bookAudioBlock";
import { readBookImage } from "./bookImageBlock";
export const wholeBookSoundSchema = z.object({
  kind: z.enum(["text", "storyboard"]),
  dialogueOnly: z.boolean(),
  segment: z.number().int().min(0).max(199).optional(),
});
export type WholeBookSound = z.infer<typeof wholeBookSoundSchema>;
/** Every chapter in manuscript order; media and shot directions are never spoken. */
export function wholeBookSoundText(
  chapters: Array<{
    blocks: { body: string; writingStyle?: BookWritingStyle };
  }>,
  dialogueOnly: boolean
) {
  return chapters
    .flatMap(chapter =>
      writingModuleTexts(
        chapter.blocks.body,
        chapter.blocks.writingStyle
      ).filter(
        (text, i) =>
          text.trim() &&
          !/^!\[[^\]]*\]\([^\n]+\)$/.test(text.trim()) &&
          !readBookImage(text) &&
          !readBookAudio(text) &&
          (!dialogueOnly ||
            chapter.blocks.writingStyle?.[i]?.videoRole === "dialogue")
      )
    )
    .join("\n\n");
}
export function narrationSegments(text: string): string[] {
  const characters = Array.from(text),
    result: string[] = [];
  // UTF-16 limit is also respected for providers that count surrogate pairs twice.
  let current = "";
  for (const character of characters) {
    if (current.length + character.length > 4800) {
      result.push(current);
      current = "";
    }
    current += character;
  }
  if (current) result.push(current);
  return result;
}
