import { readBookImage } from "../../shared/bookImageBlock";
import type { ManuscriptContent } from "../../shared/bookWorkflow";
import type { BookPageReading } from "../../shared/bookPageReading";
import { storyPageReadings } from "./storyPictureRecall";

export function manuscriptPictureUrls(bodies: string[]) {
  return [
    ...new Set(
      bodies.flatMap(body =>
        body.split("\n").flatMap(line => {
          const image = readBookImage(line);
          return image && !image.videoUrl ? [image.url] : [];
        })
      )
    ),
  ];
}

export async function manuscriptReadings(
  input: { storyId: number; userId: number },
  bodies: string[]
) {
  const urls = manuscriptPictureUrls(bodies);
  return !urls.length
    ? []
    : storyPageReadings(input.userId, input.storyId, urls);
}

/** Only the adaptation input changes. Keep the archived chapter, layout and original image intact. */
export function pagesAsSources(
  chapters: ManuscriptContent[],
  readings: Array<{ url: string; reading: BookPageReading }>
) {
  if (!readings.length) return chapters;
  const byUrl = new Map(readings.map(r => [r.url, r.reading]));
  return chapters.map(chapter => {
    const replaced = new Set<string>();
    const body = chapter.blocks.body
      .split("\n")
      .map(line => {
        const image = readBookImage(line);
        const source = image && !image.videoUrl && byUrl.get(image.url);
        if (!image || !source) return line;
        replaced.add(image.url);
        return (
          source.label +
          "（" +
          source.origin +
          "）：" +
          (source.text.replace(/\s*\n\s*/g, " ").slice(0, 6000) ||
            "文字尚待核对")
        );
      })
      .join("\n");
    if (!replaced.size) return chapter;
    const layout = chapter.layout && {
      ...chapter.layout,
      pages: chapter.layout.pages.map(page => ({
        ...page,
        modules: page.modules.filter(
          module => module.kind !== "image" || !replaced.has(module.imageUrl)
        ),
      })),
    };
    return { ...chapter, layout, blocks: { ...chapter.blocks, body } };
  });
}
