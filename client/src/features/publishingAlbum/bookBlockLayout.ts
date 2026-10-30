import { validColumnPairs } from '@shared/bookWritingStyle';
import { readBookImage, bookImageText } from "@shared/bookImageBlock";
import { blockAncestors, blockSubtreeEnd, isHeading, moveWritingBlock, newWritingBlock, type BlockDrop, type WritingBlock, type BookPlacement } from './chapterBlockTree';
import { textModuleHeight } from './imagePackModules';

export type { BookPlacement } from "./chapterBlockTree";
export type BookBlockLayout = { block: WritingBlock; index: number; placement: BookPlacement; imageFactor: number; imageOriginX: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const bookBaseFont = (block: WritingBlock) => block.format === 'heading1' ? 36 : block.format === 'heading2' ? 32 : block.format === 'heading3' ? 28 : 24;

/** All paragraphs follow document order. Legacy free coordinates are retained in cache but never used for placement. */
export function layoutBookBlocks(blocks: WritingBlock[], imageRatios: Record<string, number> = {}): BookBlockLayout[] {
  const pairs = validColumnPairs(blocks);
  const result: BookBlockLayout[] = [];
  type Cursor = { page: number; bottom: number };
  function range(from: number, end: number, left: number, right: number, depth: number, cursor: Cursor, skipPair?: string, alignEnd = false): Cursor {
    let { page, bottom } = cursor;
    for (let index = from; index < end; index++) {
      const block = blocks[index], ancestors = blockAncestors(blocks, block.id);
      if (ancestors.some(id => blocks.find(item => item.id === id)?.collapsed)) continue;
      const partner = pairs.get(block.id);
      if (partner && block.id !== skipPair) {
        const second = blocks.findIndex(item => item.id === partner);
        const after = blockSubtreeEnd(blocks, second);
        const rowLeft = left + Math.min(Math.max(0, ancestors.length - depth), 4) * 12;
        const columnWidth = (right - rowLeft - 16) / 2;
        // Start both columns together; each column paginates without overlapping the other.
        const start = { page, bottom };
        const firstCount = result.length;
        let a = range(index, second, rowLeft, rowLeft + columnWidth, ancestors.length, start, block.id, true);
        let b = range(second, after, rowLeft + columnWidth + 16, right, ancestors.length, start, partner);
        // If either first block didn't fit, move the entire row to the next page together.
        const firstLeft = result[firstCount], firstRight = result.find(item => item.block.id === partner);
        if (bottom > 48 && (firstLeft?.placement.page !== page || firstRight?.placement.page !== page)) {
          result.splice(firstCount);
          const nextPage = { page: page + 1, bottom: 48 };
          a = range(index, second, rowLeft, rowLeft + columnWidth, ancestors.length, nextPage, block.id, true);
          b = range(second, after, rowLeft + columnWidth + 16, right, ancestors.length, nextPage, partner);
        }
        const latest = a.page > b.page ? a : b.page > a.page ? b : { page: a.page, bottom: Math.max(a.bottom, b.bottom) };
        page = latest.page; bottom = latest.bottom; index = after - 1;
        continue;
      }
      const image = readBookImage(block.text), base = bookBaseFont(block);
      const fontSize = clamp(image ? base * image.scale : block.book?.fontSize ?? base, base / 2, base * 2);
      const baseX = left + (isHeading(block) ? 16 : 0) + Math.min(Math.max(0, ancestors.length - depth), 4) * 12;
      const available = Math.max(24, right - baseX);
      const factor = Math.min(available / 900, 1104 / 1200);
      const frame = image?.frame;
      const offsetY = frame ? frame.y * factor : 0;
      let x = baseX + (frame?.x ?? 0) * factor;
      let width = image ? (frame?.width ?? 900) * factor : available;
      let height = frame ? frame.height * factor : image ? Math.min(1104, 300 * fontSize / base) : Math.min(1104, Math.max(52, textModuleHeight(block.text, width, fontSize, (glyph, size) => /[\u0000-\u007f]/.test(glyph) ? size * .6 : size)));
      const aspect = image && imageRatios[image.url];
      if (image && !frame && aspect && aspect > 0) {
        const croppedAspect = aspect * image.crop.width / image.crop.height;
        width = Math.min(width, height * croppedAspect); height = width / croppedAspect;
      }
      if (alignEnd && index === from && image && !frame) x = right - width;
      if (bottom + offsetY + height > 1152) { page++; bottom = 48; }
      const placement = { page, rect: { x, y: bottom + offsetY, width, height }, fontSize };
      bottom = placement.rect.y + height + 12;
      result.push({ block, index, placement, imageFactor: factor, imageOriginX: baseX });
    }
    return { page, bottom };
  }
  range(0, blocks.length, 24, 884, 0, { page: 0, bottom: 48 });
  return result;
}

/** Size is relative to the block's format, never compounded past ½×–2×. */
export function resizeBookBlock(blocks: WritingBlock[], id: string, fontSize: number): WritingBlock[] {
  const layout = layoutBookBlocks(blocks).find(item => item.block.id === id);
  if (!layout) return blocks;
  const base = bookBaseFont(layout.block);
  const next = clamp(fontSize, base / 2, base * 2);
  if (next === layout.placement.fontSize) return blocks;
  return blocks.map(block => block.id === id ? { ...block, ...(readBookImage(block.text) ? {text:bookImageText(readBookImage(block.text)!.url,readBookImage(block.text)!.crop,next/base,readBookImage(block.text)!.frame,readBookImage(block.text)!.videoUrl)} : {}), book: { ...layout.placement, fontSize: next } } : block);
}

export type BookDropTarget = { id: string; position: BlockDrop | 'left' | 'right' };
export type BookDropBox = { id: string; top: number; bottom: number; left?: number; right?: number };
/** Pointer capture keeps events on the handle; hit-test visible targets using their actual DOM bounds. */
export function findBookDrop(blocks: WritingBlock[], sourceId: string, boxes: BookDropBox[], y: number, x?: number, allowColumns = false): BookDropTarget | null {
  const source = boxes.find(box => box.id === sourceId);
  if (source && y >= source.top && y <= source.bottom && (x === undefined || source.left === undefined || source.right === undefined || x >= source.left && x <= source.right)) return null;
  const candidates = boxes.filter(box => box.id !== sourceId && !blockAncestors(blocks, box.id).includes(sourceId));
  const target = candidates.reduce<BookDropBox | null>((best, box) => {
    const distance = (item: BookDropBox) => Math.hypot(Math.max(item.top - y, 0, y - item.bottom), x === undefined || item.left === undefined || item.right === undefined ? 0 : Math.max(item.left - x, 0, x - item.right));
    return !best || distance(box) < distance(best) ? box : best;
  }, null);
  if (!target) return null;
  const fraction = (y - target.top) / Math.max(1, target.bottom - target.top);
  const block = blocks.find(item => item.id === target.id)!;
  if (allowColumns && x !== undefined && target.left !== undefined && target.right !== undefined && fraction >= .15 && fraction <= .85) {
    const width = target.right - target.left;
    if (x <= target.left + width * .22) return { id: target.id, position: 'left' };
    if (x >= target.right - width * .22) return { id: target.id, position: 'right' };
  }
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
