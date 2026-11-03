import { bookImageText, readBookImage } from "@shared/bookImageBlock";
import { readBookAudio } from "@shared/bookAudioBlock";
import {
  blockBody,
  blockSubtreeEnd,
  isHeading,
  newWritingBlock,
  type WritingBlock,
} from "./chapterBlockTree";
import { insideBookLatex } from "./bookLatex";

export type BookImageAnchor =
  | { kind: "text"; id: string; text: string; offset: number }
  | { kind: "edge"; id: string; side: "before" | "after" }
  | { kind: "empty" };

/** Freeze the insertion point before uploading; never replace a text selection with an image. */
export function captureBookImageAnchor(
  blocks: WritingBlock[],
  id?: string | null,
  offset?: number
): BookImageAnchor {
  const block = blocks.find(item => item.id === id) ?? blocks.at(-1);
  if (!block) return { kind: "empty" };
  if (
    block.id === id &&
    offset !== undefined &&
    !isHeading(block) &&
    !readBookImage(block.text) &&
    !readBookAudio(block.text) &&
    !insideBookLatex(block.text, offset)
  )
    return {
      kind: "text",
      id: block.id,
      text: block.text,
      offset: Math.max(0, Math.min(offset, block.text.length)),
    };
  return { kind: "edge", id: block.id, side: "after" };
}

export function insertBookImages(
  blocks: WritingBlock[],
  anchor: BookImageAnchor,
  urls: string[]
) {
  if (!urls.length) throw new Error("没有可插入的图片");
  const index =
    anchor.kind === "empty"
      ? -1
      : blocks.findIndex(block => block.id === anchor.id);
  if (
    (anchor.kind !== "empty" && index < 0) ||
    (anchor.kind === "empty" && blocks.length)
  )
    throw new Error("插入位置已变化，图片已保留在素材仓库，可从仓库重新加入。");
  const current = blocks[index];
  if (anchor.kind === "text" && current.text !== anchor.text)
    throw new Error(
      "插入位置的文字已变化，图片已保留在素材仓库，可从仓库重新加入。"
    );
  let parent = current?.parentId ?? null;
  let at = index < 0 ? 0 : index;
  let next = [...blocks];
  if (anchor.kind === "edge" && anchor.side === "after") {
    at =
      isHeading(current) && current.collapsed
        ? blockSubtreeEnd(blocks, index)
        : index + 1;
    if (isHeading(current) && !current.collapsed) parent = current.id;
  } else if (anchor.kind === "text") {
    if (anchor.offset === current.text.length && current.text) at = index + 1;
    else if (anchor.offset > 0) {
      next[index] = { ...current, text: current.text.slice(0, anchor.offset) };
      next.splice(index + 1, 0, {
        ...current,
        id: crypto.randomUUID(),
        text: current.text.slice(anchor.offset),
      });
      at = index + 1;
    }
  }
  const images = urls.map(url => newWritingBlock(bookImageText(url), parent));
  next.splice(at, 0, ...images);
  if (blockBody(next).length > 200_000)
    throw new Error("文章过长，图片已保留在素材仓库。");
  return { blocks: next, firstId: images[0].id };
}

export type ImageDropBox = {
  id: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
};
export function bookImageDropAnchor(
  boxes: ImageDropBox[],
  x: number,
  y: number
): Extract<BookImageAnchor, { kind: "edge" }> | null {
  const closest = boxes.reduce<ImageDropBox | null>((best, box) => {
    const distance = (b: ImageDropBox) =>
      Math.max(b.top - y, 0, y - b.bottom) * 10_000 +
      Math.max(b.left - x, 0, x - b.right);
    return !best || distance(box) < distance(best) ? box : best;
  }, null);
  return closest
    ? {
        kind: "edge",
        id: closest.id,
        side: y < (closest.top + closest.bottom) / 2 ? "before" : "after",
      }
    : null;
}
