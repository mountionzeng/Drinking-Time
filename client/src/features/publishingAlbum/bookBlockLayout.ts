import { readBookImage, bookImageText } from "./bookImageBlock";
import { blockAncestors, isHeading, moveWritingBlock, newWritingBlock, type BlockDrop, type WritingBlock, type BookPlacement } from './chapterBlockTree';
import { textModuleHeight } from './imagePackModules';

export type { BookPlacement } from "./chapterBlockTree";
export type BookBlockLayout = { block: WritingBlock; index: number; placement: BookPlacement };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const bookBaseFont = (block: WritingBlock) => block.format === 'heading1' ? 36 : block.format === 'heading2' ? 32 : block.format === 'heading3' ? 28 : 24;

/** All paragraphs follow document order. Legacy free coordinates are retained in cache but never used for placement. */
export function layoutBookBlocks(blocks: WritingBlock[], imageRatios: Record<string, number> = {}): BookBlockLayout[] {
  let page = 0, bottom = 48;
  return blocks.flatMap((block, index) => {
    const ancestors = blockAncestors(blocks, block.id);
    if (ancestors.some(id => blocks.find(item => item.id === id)?.collapsed)) return [];
    const base = bookBaseFont(block);
    const fontSize = clamp(readBookImage(block.text) ? base * readBookImage(block.text)!.scale : block.book?.fontSize ?? base, base / 2, base * 2);
    const baseX = (isHeading(block) ? 40 : 24) + Math.min(ancestors.length, 4) * 12;
    const image = readBookImage(block.text);
    const factor = Math.min((884-baseX)/900, 1104/1200);
    const frame = image?.frame;
    const offsetY = frame ? frame.y * factor : 0;
    const x = baseX + (frame?.x ?? 0) * factor;
    let width = image ? (frame?.width ?? 900) * factor : 884-baseX;
    let height = frame ? frame.height * factor : image ? 300 * fontSize / base : Math.min(1104, Math.max(52, textModuleHeight(block.text, width, fontSize, (glyph, size) => /[\u0000-\u007f]/.test(glyph) ? size * .6 : size)));
    const aspect = image && imageRatios[image.url];
    if (image && !frame && aspect && aspect > 0) {
      const croppedAspect = aspect * image.crop.width / image.crop.height;
      width = Math.min(width,height*croppedAspect);
      height = width/croppedAspect;
    }
    if (bottom + offsetY + height > 1152) { page++; bottom = 48; }
    const placement = { page, rect: { x, y: bottom + offsetY, width, height }, fontSize };
    bottom = placement.rect.y + height + 12;
    return [{ block, index, placement }];
  });
}

/** Size is relative to the block's format, never compounded past ½×–2×. */
export function resizeBookBlock(blocks: WritingBlock[], id: string, fontSize: number): WritingBlock[] {
  const layout = layoutBookBlocks(blocks).find(item => item.block.id === id);
  if (!layout) return blocks;
  const base = bookBaseFont(layout.block);
  const next = clamp(fontSize, base / 2, base * 2);
  if (next === layout.placement.fontSize) return blocks;
  return blocks.map(block => block.id === id ? { ...block, ...(readBookImage(block.text) ? {text:bookImageText(readBookImage(block.text)!.url,readBookImage(block.text)!.crop,next/base)} : {}), book: { ...layout.placement, fontSize: next } } : block);
}

export type BookDropTarget = { id: string; position: BlockDrop };
export type BookDropBox = { id: string; top: number; bottom: number };
/** Pointer capture keeps events on the handle; hit-test visible targets using their actual DOM bounds. */
export function findBookDrop(blocks: WritingBlock[], sourceId: string, boxes: BookDropBox[], y: number): BookDropTarget | null {
  const source = boxes.find(box => box.id === sourceId);
  if (source && y >= source.top && y <= source.bottom) return null;
  const candidates = boxes.filter(box => box.id !== sourceId && !blockAncestors(blocks, box.id).includes(sourceId));
  const target = candidates.reduce<BookDropBox | null>((best, box) => {
    const distance = (item: BookDropBox) => Math.max(item.top - y, 0, y - item.bottom);
    return !best || distance(box) < distance(best) ? box : best;
  }, null);
  if (!target) return null;
  const fraction = (y - target.top) / Math.max(1, target.bottom - target.top);
  const block = blocks.find(item => item.id === target.id)!;
  return { id: target.id, position: isHeading(block) && fraction >= .25 && fraction <= .75
    ? 'inside' : fraction < .5 ? 'before' : 'after' };
}

export function moveBookBlockByKey(blocks: WritingBlock[], id: string, key: string): WritingBlock[] {
  const visible = layoutBookBlocks(blocks).map(item => item.block);
  const index = visible.findIndex(block => block.id === id);
  if (index < 0) return blocks;
  const current = visible[index];
  const previous = visible[index - 1];
  const following = visible.slice(index + 1).find(block => !blockAncestors(blocks, block.id).includes(id));
  if (key === 'ArrowUp' && previous) return moveWritingBlock(blocks, id, previous.id, 'before');
  if (key === 'ArrowDown' && following) return moveWritingBlock(blocks, id, following.id, 'after');
  if (key === 'ArrowRight' && previous && isHeading(previous)) return moveWritingBlock(blocks, id, previous.id, 'inside');
  if (key === 'ArrowLeft' && current.parentId) return moveWritingBlock(blocks, id, current.parentId, 'after');
  return blocks;
}

/** Deleting a heading removes only that block; its children remain readable. */
export function deleteBookBlock(blocks: WritingBlock[], id: string): WritingBlock[] {
  const removed = blocks.find(block => block.id === id); if (!removed) return blocks;
  const next = blocks.filter(block => block.id !== id).map(block => block.parentId === id ? { ...block, parentId: removed.parentId } : block);
  return next.length ? next : [newWritingBlock('')];
}
