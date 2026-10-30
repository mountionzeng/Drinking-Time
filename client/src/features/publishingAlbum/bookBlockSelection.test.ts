import { describe, expect, it } from 'vitest';
import { bookImageText, readBookImage } from '@shared/bookImageBlock';
import { blockBody, restoreWritingBlocks, type WritingBlock } from './chapterBlockTree';
import { layoutBookBlocks } from './bookBlockLayout';
import { intersectingBookIds, moveBookSelection, resizeBookSelection, selectedBookIds } from './bookBlockSelection';
const block = (id: string, parentId: string | null = null, heading = false): WritingBlock => ({ id, text: id, format: heading ? 'heading1' : 'text', parentId, collapsed: false });

describe('book multiselection', () => {
  it('selects intersecting modules without requiring full enclosure', () => {
    expect(intersectingBookIds({ left: 0, top: 40, right: 50, bottom: 80 }, [
      { id: 'a', left: 20, top: 20, right: 80, bottom: 50 },
      { id: 'b', left: 20, top: 80, right: 80, bottom: 100 },
    ])).toEqual(['a']);
  });
  it('moves disconnected selections in document order into a heading and opens it', () => {
    const blocks = [block('a'), block('b'), block('c'), { ...block('h', null, true), collapsed: true }, block('d', 'h')];
    const next = moveBookSelection(blocks, ['c', 'a'], { id: 'h', position: 'inside' });
    expect(next.map(b => b.id)).toEqual(['b', 'h', 'd', 'a', 'c']);
    expect(next.slice(3).map(b => b.parentId)).toEqual(['h', 'h']);
    expect(next[1].collapsed).toBe(false);
    expect(restoreWritingBlocks(blockBody(next), { body: blockBody(next), blocks: next })).toEqual(next);
  });
  it('includes collapsed descendants only once, prevents dropping into its own subtree', () => {
    const blocks = [{ ...block('h', null, true), collapsed: true }, block('a', 'h'), block('b'), block('c')];
    expect([...selectedBookIds(blocks, ['h', 'a'])]).toEqual(['h', 'a']);
    expect(moveBookSelection(blocks, ['h', 'b'], { id: 'a', position: 'before' })).toBe(blocks);
    const next = moveBookSelection(blocks, ['h', 'b'], { id: 'c', position: 'after' });
    expect(next.map(b => b.id)).toEqual(['c', 'h', 'a', 'b']);
    expect(next[2].parentId).toBe('h');
  });
  it('moves selected siblings out of a heading without moving unselected siblings', () => {
    const blocks = [block('h', null, true), block('a', 'h'), block('b', 'h'), block('c', 'h'), block('d')];
    const next = moveBookSelection(blocks, ['a', 'c'], { id: 'h', position: 'after' });
    expect(next.map(b => b.id)).toEqual(['h', 'b', 'a', 'c', 'd']);
    expect(next.slice(2, 4).map(b => b.parentId)).toEqual([null, null]);
  });
  it('scales headings and text by one factor, clamps repeated gestures, and leaves no overlap', () => {
    const blocks = [block('h', null, true), block('a', 'h'), block('b')];
    const big = resizeBookSelection(blocks, ['h'], 20);
    expect(big[0].book?.fontSize).toBe(72);
    expect(big[1].book?.fontSize).toBe(48);
    expect(big[2]).toBe(blocks[2]);
    expect(resizeBookSelection(big, ['h'], 2)).toBe(big);
    const small = resizeBookSelection(big, ['h'], .001);
    expect(small[0].book?.fontSize).toBe(18);
    expect(small[1].book?.fontSize).toBe(12);
    const layouts = layoutBookBlocks(big);
    for (let i = 1; i < layouts.length; i++) expect(layouts[i].placement.rect.y).toBeGreaterThanOrEqual(layouts[i-1].placement.rect.y + layouts[i-1].placement.rect.height);
  });
  it('scales image geometry with text while preserving crop, video, and source', () => {
    const image = { ...block('i'), text: bookImageText('https://example.com/image.png', { x: .1, y: .2, width: .7, height: .6 }, 1, { x: 20, y: 10, width: 300, height: 200 }, 'https://example.com/clip.mp4') };
    const next = resizeBookSelection([block('a'), image], ['a', 'i'], 1.5);
    expect(next[0].book?.fontSize).toBe(36);
    expect(readBookImage(next[1].text)).toEqual({ ...readBookImage(image.text), scale: 1.5, frame: { x: 20, y: 10, width: 450, height: 300 } });
    expect(restoreWritingBlocks(blockBody(next), { body: blockBody(next), blocks: next })).toEqual(next);
  });
});
