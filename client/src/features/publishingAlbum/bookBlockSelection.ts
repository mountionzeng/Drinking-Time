import { normalizeWritingColumns, validColumnPairs } from '@shared/bookWritingStyle';
import { bookImageText, readBookImage } from '@shared/bookImageBlock';
import { blockAncestors, blockSubtreeEnd, isHeading, type WritingBlock } from './chapterBlockTree';
import { BOOK_BODY_FONT_SIZE, bookBaseFont, layoutBookBlocks, type BookDropTarget } from './bookBlockLayout';

/** A selected heading carries its subtree, even while collapsed. */
export function selectedBookIds(blocks: WritingBlock[], ids: readonly string[]): Set<string> {
  const selected = new Set(ids);
  return new Set(blocks.filter(block => selected.has(block.id) || blockAncestors(blocks, block.id).some(id => selected.has(id))).map(block => block.id));
}

export function moveBookSelection(blocks: WritingBlock[], ids: readonly string[], drop: BookDropTarget): WritingBlock[] {
  const selected = selectedBookIds(blocks, ids);
  if (!selected.size || selected.has(drop.id)) return blocks;
  const rest = blocks.filter(block => !selected.has(block.id));
  const targetIndex = rest.findIndex(block => block.id === drop.id);
  const target = rest[targetIndex];
  if (!target || drop.position === 'inside' && !isHeading(target)) return blocks;
  const side = drop.position === 'left' || drop.position === 'right';
  const roots = blocks.filter(block => selected.has(block.id) && (!block.parentId || !selected.has(block.parentId)));
  if (side && (roots.length !== 1 || blockAncestors(blocks, roots[0].id).includes(target.id))) return blocks;
  const parentId = drop.position === 'inside' ? target.id : target.parentId;
  const moving = blocks.filter(block => selected.has(block.id)).map(block =>
    block.parentId && selected.has(block.parentId) ? block : { ...block, parentId });
  const at = drop.position === 'before' || drop.position === 'left' ? targetIndex : blockSubtreeEnd(rest, targetIndex);
  const result = rest.map(block => block.id === target.id && drop.position === 'inside' ? { ...block, collapsed: false } : block);
  result.splice(at, 0, ...moving);
  if (side) {
    const group = crypto.randomUUID();
    const oldGroups = new Set([roots[0].columnGroup, target.columnGroup].filter(Boolean));
    return normalizeWritingColumns(result.map(block => {
      if (block.id === roots[0].id || block.id === target.id) return { ...block, columnGroup: group, columnRatio: .5 };
      if (block.columnGroup && oldGroups.has(block.columnGroup)) { const { columnGroup, ...rest } = block; return rest; }
      return block;
    }));
  }
  // Moving only one member out of a row dissolves that row, even when it stays adjacent.
  const splitGroups = new Set(roots.filter(root => root.columnGroup && blocks.some(block => block.columnGroup === root.columnGroup && !selected.has(block.id))).map(root => root.columnGroup));
  return normalizeWritingColumns(result.map(block => {
    if (block.columnGroup && splitGroups.has(block.columnGroup)) { const { columnGroup, ...rest } = block; return rest; }
    return block;
  }));
}

/** One bounded scale factor for the group, recalculated from the gesture's original snapshot. */
export function resizeBookSelection(blocks: WritingBlock[], ids: readonly string[], requested: number, ratios: Record<string, number> = {}): WritingBlock[] {
  if (!Number.isFinite(requested)) return blocks;
  const selected = selectedBookIds(blocks, ids);
  const items = layoutBookBlocks(blocks, ratios);
  const leftColumns = new Set(validColumnPairs(blocks).keys());
  const origins = new Map(items.map(item => [item.block.id, item.imageOriginX]));
  const units = new Map(items.map(item => [item.block.id, item.imageFactor]));
  const layouts = new Map(layoutBookBlocks(blocks, ratios).map(item => [item.block.id, item.placement]));
  let lower = 0, upper = Infinity;
  for (const block of blocks.filter(block => selected.has(block.id))) {
    const image = readBookImage(block.text);
    const size = image?.scale ?? Math.max(BOOK_BODY_FONT_SIZE, block.book?.fontSize ?? bookBaseFont(block)) / bookBaseFont(block);
    lower = Math.max(lower, (image ? .5 : BOOK_BODY_FONT_SIZE / bookBaseFont(block)) / size); upper = Math.min(upper, 2 / size);
    if (image) {
      const placement = layouts.get(block.id);
      const baseX = 24 + Math.min(blockAncestors(blocks, block.id).length, 4) * 12;
      const unit = units.get(block.id) ?? Math.min((884 - baseX) / 900, 1104 / 1200);
      const frame = image.frame ?? (placement ? { x: (placement.rect.x - (origins.get(block.id) ?? baseX)) / unit, y: 0, width: placement.rect.width / unit, height: placement.rect.height / unit } : undefined);
      if (frame) upper = Math.min(upper, (leftColumns.has(block.id) ? frame.x + frame.width : 900 - frame.x) / frame.width, (1200 - frame.y) / frame.height);
    }
  }
  const factor = Math.max(lower, Math.min(upper, requested));
  if (!selected.size || factor === 1) return blocks;
  return blocks.map(block => {
    if (!selected.has(block.id)) return block;
    const image = readBookImage(block.text);
    if (image) {
      const placement = layouts.get(block.id);
      const baseX = 24 + Math.min(blockAncestors(blocks, block.id).length, 4) * 12;
      const unit = units.get(block.id) ?? Math.min((884 - baseX) / 900, 1104 / 1200);
      const frame = image.frame ?? (placement ? { x: (placement.rect.x - (origins.get(block.id) ?? baseX)) / unit, y: 0, width: placement.rect.width / unit, height: placement.rect.height / unit } : undefined);
      return { ...block, text: bookImageText(image.url, image.crop, image.scale * factor,
        frame ? { ...frame, x: leftColumns.has(block.id) ? Math.max(0, frame.x + frame.width * (1 - factor)) : frame.x, width: frame.width * factor, height: frame.height * factor } : undefined, image.videoUrl) };
    }
    const placement = layouts.get(block.id) ?? block.book ?? { page: 0, rect: { x: 24, y: 48, width: 860, height: 52 }, fontSize: bookBaseFont(block) };
    return { ...block, book: { ...placement, fontSize: Math.max(BOOK_BODY_FONT_SIZE, placement.fontSize) * factor } };
  });
}

export type SelectionBox = { left: number; top: number; right: number; bottom: number };
export function intersectingBookIds(box: SelectionBox, items: Array<SelectionBox & { id: string }>): string[] {
  return items.filter(item => item.right > box.left && item.left < box.right && item.bottom > box.top && item.top < box.bottom).map(item => item.id);
}

/** A single member adjusts the divider; explicit multiselection scales content instead. */
export function resizeBookColumn(blocks: WritingBlock[], id: string, delta: number): WritingBlock[] {
  const pair = [...validColumnPairs(blocks)].find(([a,b]) => a === id || b === id);
  if (!pair || !Number.isFinite(delta)) return blocks;
  const [left,right] = pair;
  const ratio = Math.max(.2, Math.min(.8, (blocks.find(b => b.id === left)?.columnRatio ?? .5) + delta));
  return blocks.map(block => block.id === left || block.id === right ? {...block, columnRatio: ratio} : block);
}
