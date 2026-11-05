import {
  bookTextParts,
  displayLatexText,
  type BookTextPart,
} from "@shared/bookTextFormat";
import {
  PUBLISHING_PLATFORM_REGISTRY,
  xWeightedCharacterLength,
  type PublishingPlatformId,
} from "@shared/publishingDraft";
import { buildPublishableText } from "../publishingDraft/publishingDraftViewModel";
import {
  publishingCoverFileName,
  renderPublishingCover,
} from "../publishingDraft/publishingCoverExport";
import { bookShareArticle } from "./bookShareArticle";
import { prepareBookShare } from "./prepareBookShare";

function plainParts(parts: BookTextPart[], latex = false): string {
  return parts
    .map(part => {
      if (part.kind === "text")
        return latex && !part.literal ? displayLatexText(part.raw) : part.raw;
      if (part.kind === "math") return part.raw;
      return plainParts(part.children, latex || !part.markdown);
    })
    .join("");
}

/** Format a disposable export copy; never rewrite the saved book or call a model. */
export function bookPlatformText(
  title: string,
  body: string,
  platform: PublishingPlatformId
): string {
  const article = bookShareArticle(title, body, platform);
  const content = {
    title: plainParts(bookTextParts(article.title)),
    body: plainParts(bookTextParts(article.body)),
    tags: [],
  };
  if (platform !== "x") return buildPublishableText(content, platform);

  // Reserve room for thread numbering; keep every character and paragraph in order.
  const source = buildPublishableText(content);
  const posts: string[] = [];
  let current = "";
  const append = (chunk: string) => {
    const joined = current ? `${current}\n${chunk}` : chunk;
    if (current && xWeightedCharacterLength(joined) > 268) {
      posts.push(current);
      current = chunk;
    } else current = joined;
  };
  for (const paragraph of source.split(/\n[\t ]*\n+/)) {
    let chunk = "";
    let weight = 0;
    for (const { segment } of new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    }).segment(paragraph)) {
      const next = xWeightedCharacterLength(segment);
      if (chunk && weight + next > 268) {
        append(chunk);
        chunk = "";
        weight = 0;
      }
      chunk += segment;
      weight += next;
    }
    if (chunk.trim()) append(chunk);
  }
  if (current) posts.push(current);
  return buildPublishableText(
    { title: "", body: posts.join("\n\n"), tags: [] },
    platform
  );
}

export async function prepareBookPlatformImages(
  title: string,
  body: string,
  platform: PublishingPlatformId,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const book = await prepareBookShare(body);
  signal.throwIfAborted();
  if (!book) return [];
  const images = book.reading.blocks.filter(block => block.kind === "image");
  if (images.length > 9)
    throw new Error("一次最多导出 9 张配图；请分批分享或使用文章链接。");
  const result = [];
  for (const [index, image] of images.entries()) {
    signal.throwIfAborted();
    const blob = await renderPublishingCover({
      imageUrl: book.pages[image.image].url,
      platform,
      containCrop: image.crop,
    });
    signal.throwIfAborted();
    result.push({
      blob,
      filename: publishingCoverFileName(title, platform).replace(
        /\.png$/,
        `-${index + 1}.png`
      ),
      width: PUBLISHING_PLATFORM_REGISTRY[platform].cover.width,
      height: PUBLISHING_PLATFORM_REGISTRY[platform].cover.height,
    });
  }
  return result;
}
