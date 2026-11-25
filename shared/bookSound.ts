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

/** A marked paragraph may contain both a quoted voice-over and a camera direction. */
export function splitBookVoiceLine(line: string) {
    const match = /^\s*(?:画外音|旁白|对白|台词)(?:继续)?(?:[（(][^（）()\n]*[）)])?\s*[：:]\s*(?:「([^「」]+)」|“([^“”]+)”|"([^"]+)")\s*([\s\S]*)$/u.exec(line);
    if (!match) return;
    const tail = match[4].trim();
    if (tail && !/^[。！？.!?]?$/.test(tail) &&
        !/^[。！？.!?]?\s*(?:画面|镜头)(?:[：:]|切|转|拉|推|跟|渐|缓)/u.test(tail)) return;
    // An additional spoken passage on this line needs review as a whole.
    if (/[「“"]/.test(tail)) return;
    return { spoken: (match[1] ?? match[2] ?? match[3]).trim(), speech: line.slice(0, line.length - match[4].length), direction: match[4] };
}
export function spokenBookDialogue(text: string): string {
  return text.split("\n").map(line => splitBookVoiceLine(line)?.spoken ?? line).join("\n");
}
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
      ).map(text => dialogueOnly ? spokenBookDialogue(text) : text)
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
