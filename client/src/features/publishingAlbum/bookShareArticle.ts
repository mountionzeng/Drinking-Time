import { readBookImage } from "@shared/bookImageBlock";
import { readBookAudio } from "@shared/bookAudioBlock";
import type { StoryContextSnapshot } from "@shared/storyContextShare";
import { splitBookTextModules } from "./bookLatex";
import type { BookShareReading } from "@shared/bookShare";

/** The existing text sharing flow does not carry book media or their access URLs. */
export function bookShareArticle(title: string, body: string, platform: NonNullable<StoryContextSnapshot["article"]>["platform"] = "xiaohongshu"): NonNullable<StoryContextSnapshot["article"]> {
  const text = splitBookTextModules(body).filter(block => !readBookImage(block.trim()) && !readBookAudio(block.trim())).join("\n");
  if (!text.trim() && !splitBookTextModules(body).some(block => readBookImage(block.trim()))) throw new Error("请先写好要分享的正文");
  return { title, body: text, platform, tags: [] };
}

export function bookShareReading(body: string): { reading: BookShareReading; urls: string[] } {
  const urls: string[] = [];
  const blocks: BookShareReading["blocks"] = [];
  for (const text of splitBookTextModules(body)) {
    const image = readBookImage(text.trim());
    if (image) {
      let index = urls.indexOf(image.url);
      if (index < 0) { index = urls.length; urls.push(image.url); }
      blocks.push({ kind: "image", image: index, crop: image.crop });
    } else if (readBookAudio(text.trim())) {
      blocks.push({ kind: "text", text: `［${readBookAudio(text.trim())!.title}］` });
    } else {
      const previous = blocks.at(-1);
      if (previous?.kind === "text") previous.text += `\n${text}`;
      else blocks.push({ kind: "text", text });
    }
  }
  if (urls.length > 9) throw new Error("一次最多分享 9 张不同的插图，请减少图片后重试；正文未被截断。");
  return { reading: { blocks }, urls };
}
