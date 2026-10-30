import { describe, expect, it } from 'vitest';
import { bookWritingStyleSchema, normalizeWritingColumns, sameWritingStyle, validWritingStyle } from '@shared/bookWritingStyle';
import { bookImageText, readBookImage } from '@shared/bookImageBlock';
import { blockBody, insertBlockText, restoreStyledBlocks, writingStyleOf, type WritingBlock } from './chapterBlockTree';
import { findBookDrop, layoutBookBlocks } from './bookBlockLayout';
import { linkedBookResizeIds, moveBookSelection, resizeBookSelection } from './bookBlockSelection';
const b = (id: string, text = id, parentId: string | null = null): WritingBlock => ({ id, text, format: 'text', parentId, collapsed: false });
const pair = (blocks: WritingBlock[], source: string, target: string, side: 'left' | 'right' = 'left') => moveBookSelection(blocks, [source], { id: target, position: side });

describe('book columns', () => {
  it('places image and paragraph together with a narrow gutter and follows the taller cell', () => {
    const url = 'https://example.com/a.png';
    const blocks = pair([b('text', '长长的文字'.repeat(30)), b('image', bookImageText(url)), b('next')], 'image', 'text');
    const [left, right, next] = layoutBookBlocks(blocks, { [url]: 1 });
    expect(left.block.id).toBe('image'); expect(right.block.id).toBe('text');
    expect(left.placement.page).toBe(right.placement.page);
    expect(left.placement.rect.y).toBe(right.placement.rect.y);
    expect(right.placement.rect.x - left.placement.rect.x - left.placement.rect.width).toBeCloseTo(16);
    expect(right.placement.rect.width).toBe(422);
    expect(next.placement.rect.y).toBeGreaterThanOrEqual(Math.max(left.placement.rect.y + left.placement.rect.height, right.placement.rect.y + right.placement.rect.height) + 12);
  });
  it('supports left/right ordering and detaching to a vertical row', () => {
    const columns = pair([b('a'), b('b'), b('c')], 'a', 'b', 'right');
    expect(columns.map(block => block.id)).toEqual(['b','a','c']);
    const separate = moveBookSelection(columns, ['a'], { id: 'b', position: 'after' });
    expect(separate.every(block => !block.columnGroup)).toBe(true);
    const rows = layoutBookBlocks(separate);
    expect(rows[1].placement.rect.y).toBeGreaterThan(rows[0].placement.rect.y);
  });
  it('keeps heading descendants in their column, including collapsed children', () => {
    const heading = { ...b('h'), format: 'heading1' as const };
    const blocks = pair([heading,b('child','子块','h'),b('right'),b('next')], 'h','right');
    expect(validWritingStyle(blockBody(blocks),writingStyleOf(blocks))).toBe(true);
    const items = layoutBookBlocks(blocks);
    expect(items[0].placement.rect.y).toBe(items[2].placement.rect.y);
    expect(items[1].placement.rect.x + items[1].placement.rect.width).toBeLessThan(items[2].placement.rect.x);
    expect(new Set(linkedBookResizeIds(blocks,['right']))).toEqual(new Set(['h','child','right']));
    const folded=blocks.map(block=>block.id==='h'?{...block,collapsed:true}:block);
    expect(layoutBookBlocks(folded).map(item=>item.block.id)).toEqual(['h','right','next']);
  });
  it('moves both columns to the next page when one first block cannot fit', () => {
    const blocks=pair([...Array.from({length:14},(_,i)=>b(`p${i}`)), b('a','文字'.repeat(50)), b('b'),b('next')],'a','b');
    const items=layoutBookBlocks(blocks);
    const a=items.find(item=>item.block.id==='a')!, right=items.find(item=>item.block.id==='b')!;
    expect(a.placement.page).toBe(right.placement.page);
    expect(a.placement.rect.y).toBe(right.placement.rect.y);
    expect(a.placement.rect.y).toBe(48);
  });
  it('scales the peer even when only one column is selected, respecting the existing limits', () => {
    const blocks=pair([b('a'),b('b'),b('c')],'a','b');
    const larger=resizeBookSelection(blocks,['a'],1.5);
    expect(larger[0].book?.fontSize).toBe(36); expect(larger[1].book?.fontSize).toBe(36);
    expect(larger[2]).toBe(blocks[2]);
    const max=resizeBookSelection(larger,['b'],99);
    expect(max[0].book?.fontSize).toBe(48); expect(max[1].book?.fontSize).toBe(48);
  });
  it('keeps image crop/source and scales its geometry with peer text', () => {
    const url='https://example.com/a.png';
    const blocks=pair([b('image',bookImageText(url)),b('text')],'image','text');
    const smaller=resizeBookSelection(blocks,['text'],.75,{[url]:1});
    const before=layoutBookBlocks(blocks,{[url]:1}), after=layoutBookBlocks(smaller,{[url]:1});
    expect(after[0].placement.rect.width / before[0].placement.rect.width).toBeCloseTo(.75);
    expect(after[1].placement.fontSize / before[1].placement.fontSize).toBeCloseTo(.75);
    expect(readBookImage(smaller[0].text)?.crop).toEqual(readBookImage(blocks[0].text)?.crop);
    expect(after[1].placement.rect.x-after[0].placement.rect.x-after[0].placement.rect.width).toBeCloseTo(16);
  });
  it('persists column membership through server schema and browser restore, detects layout-only changes', () => {
    const original=[b('a'),b('b')], columns=pair(original,'a','b');
    const style=bookWritingStyleSchema.parse(writingStyleOf(columns));
    expect(sameWritingStyle(writingStyleOf(original),style)).toBe(false);
    expect(validWritingStyle(blockBody(columns),style)).toBe(true);
    expect(restoreStyledBlocks(blockBody(columns),style)).toEqual(columns);
    expect(validWritingStyle('a\nb',[{...style[0],columnGroup:'orphan'},style[1]])).toBe(false);
  });
  it('normalizes a broken row after Enter or deletion without losing content', () => {
    const columns=pair([b('a'),b('b')],'a','b');
    const inserted=insertBlockText(columns,0,'a\nnew').blocks;
    const normalized=normalizeWritingColumns(inserted);
    expect(normalized.map(block=>block.text)).toEqual(['a','new','b']);
    expect(normalized.every(block=>!block.columnGroup)).toBe(true);
    expect(normalizeWritingColumns(columns.slice(1))[0].columnGroup).toBeUndefined();
  });
  it('resolves side drops by x and keeps vertical drops near the top/bottom', () => {
    const blocks=[b('a'),b('b')]; const boxes=[{id:'b',left:100,right:500,top:100,bottom:300}];
    expect(findBookDrop(blocks,'a',boxes,200,110,true)?.position).toBe('left');
    expect(findBookDrop(blocks,'a',boxes,200,490,true)?.position).toBe('right');
    expect(findBookDrop(blocks,'a',boxes,101,490,true)?.position).toBe('before');
    expect(findBookDrop(blocks,'a',boxes,299,110,true)?.position).toBe('after');
  });
});
