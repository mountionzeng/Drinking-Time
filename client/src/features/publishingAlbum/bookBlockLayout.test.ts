import { describe, expect, it } from 'vitest';
import { blockBody, moveWritingBlock, readBookPlacement, restoreWritingBlocks, type WritingBlock } from './chapterBlockTree';
import { deleteBookBlock, layoutBookBlocks, findBookDrop, moveBookBlockByKey, resizeBookBlock } from './bookBlockLayout';
const block = (id: string, text = id): WritingBlock => ({ id, text, format: 'text', parentId: null, collapsed: false });

describe('book module layout', () => {
  it('lays out every paragraph and spills to later pages without changing text', () => {
    const blocks = Array.from({ length: 30 }, (_, i) => block(String(i), '同一段文字'));
    const result = layoutBookBlocks(blocks);
    expect(result).toHaveLength(30);
    expect(result.at(-1)!.placement.page).toBeGreaterThan(0);
    expect(result.map(item => item.block.id)).toEqual(blocks.map(b => b.id));
    expect(result.every(({ placement: p }) => p.rect.y >= 0 && p.rect.y + p.rect.height <= 1200)).toBe(true);
  });
  it('clamps repeated resizing to half and twice each format baseline', () => {
    for (const [format, base] of [['text', 24], ['heading1', 36], ['heading2', 32], ['heading3', 28]] as const) {
      let blocks = [{ ...block('a'), format }];
      for (let i = 0; i < 5; i++) blocks = resizeBookBlock(blocks, 'a', 99999) as typeof blocks;
      expect(layoutBookBlocks(blocks)[0].placement.fontSize).toBe(base * 2);
      for (let i = 0; i < 5; i++) blocks = resizeBookBlock(blocks, 'a', -99999) as typeof blocks;
      expect(layoutBookBlocks(blocks)[0].placement.fontSize).toBe(base / 2);
    }
  });
  it('ignores legacy overlapping coordinates and reflows after typing and resizing', () => {
    const book = { page: 0, rect: { x: 70, y: 200, width: 600, height: 60 }, fontSize: 24 };
    let blocks = [block('a'), block('b'), block('c')].map(item => ({ ...item, book }));
    blocks[0].text = '一段很长的文字'.repeat(50);
    const larger = resizeBookBlock(blocks, 'a', 48);
    const layout = layoutBookBlocks(larger);
    expect(blockBody(larger)).toBe(blockBody(blocks));
    expect(blocks[0].book).toEqual(book);
    layout.slice(1).forEach((item, i) => {
      const previous = layout[i].placement, current = item.placement;
      expect(current.page > previous.page || current.rect.y >= previous.rect.y + previous.rect.height + 12).toBe(true);
    });
    expect(layout[0].placement.rect.height).toBeGreaterThan(60);
  });
  it('moves blocks before/after/inside headings, carries children, and lays out without overlap', () => {
    const blocks = [{ ...block('heading'), format: 'heading2' as const }, { ...block('child'), parentId: 'heading' }, block('outside')];
    const moved = moveWritingBlock(blocks, 'outside', 'heading', 'inside');
    expect(moved.map(b => b.id)).toEqual(['heading', 'child', 'outside']);
    expect(moved[2].parentId).toBe('heading');
    const lifted = moveBookBlockByKey(moved, 'outside', 'ArrowLeft');
    expect(lifted[2].parentId).toBeNull();
    const before = moveWritingBlock(lifted, 'outside', 'heading', 'before');
    expect(before.map(b => b.id)).toEqual(['outside', 'heading', 'child']);
    const after = moveWritingBlock(before, 'heading', 'outside', 'before');
    expect(after.map(b => b.id)).toEqual(['heading', 'child', 'outside']);
    const layout = layoutBookBlocks(after);
    expect(layout[1].placement.rect.y).toBeGreaterThan(layout[0].placement.rect.y + layout[0].placement.rect.height);
  });
  it('resolves visible insertion targets, including a collapsed heading, without dropping into itself', () => {
    const blocks = [block('a'), { ...block('h'), format: 'heading1' as const, collapsed: true }, { ...block('c'), parentId: 'h' }, block('b')];
    const boxes = [{ id: 'a', top: 0, bottom: 50 }, { id: 'h', top: 60, bottom: 110 }, { id: 'b', top: 120, bottom: 170 }];
    expect(findBookDrop(blocks, 'a', boxes, 61)).toEqual({ id: 'h', position: 'before' });
    expect(findBookDrop(blocks, 'a', boxes, 85)).toEqual({ id: 'h', position: 'inside' });
    expect(findBookDrop(blocks, 'a', boxes, 109)).toEqual({ id: 'h', position: 'after' });
    expect(findBookDrop(blocks, 'a', boxes, 165)).toEqual({ id: 'b', position: 'after' });
    expect(findBookDrop(blocks, 'a', boxes, 25)).toBeNull();
    const moved = moveWritingBlock(blocks, 'a', 'h', 'inside');
    expect(moved[0].collapsed).toBe(false);
    expect(moved.find(b => b.id === 'a')?.parentId).toBe('h');
    expect(moveWritingBlock(blocks, 'h', 'c', 'inside')).toBe(blocks);
  });
  it('deleting a collapsed heading keeps and lifts hidden children', () => {
    const blocks = [{ ...block('heading'), format: 'heading2' as const, collapsed: true }, { ...block('child'), parentId: 'heading' }, block('outside')];
    const result = deleteBookBlock(blocks, 'heading');
    expect(result.map(b => b.text)).toEqual(['child', 'outside']);
    expect(result[0].parentId).toBeNull();
    expect(layoutBookBlocks(result)).toHaveLength(2);
    expect(deleteBookBlock([block('only')], 'only')).toMatchObject([{ text: '', format: 'text' }]);
  });
  it('validates cached geometry and restores styles only for matching content', () => {
    expect(readBookPlacement({ page: -1, rect: { x: 0, y: 0, width: 100, height: 100 }, fontSize: 24 })).toBeUndefined();
    expect(readBookPlacement({ page: 0, rect: { x: NaN, y: 0, width: 100, height: 100 }, fontSize: 24 })).toBeUndefined();
    const blocks = [{ ...block('a'), emphasis: 'bright' as const, backdrop: true, book: { page: 1, rect: { x: 60, y: 100, width: 600, height: 80 }, fontSize: 24 } }];
    expect(restoreWritingBlocks('a', { body: 'a', blocks })).toEqual(blocks);
    expect(restoreWritingBlocks('different', { body: 'a', blocks })[0].book).toBeUndefined();
  });
});
