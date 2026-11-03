import { describe, expect, it } from 'vitest';
import { blockBody, restoreStyledBlocks, writingStyleOf, type WritingBlock } from './chapterBlockTree';
import { bookTextRangeParts, clampBookTextFocus, replaceBookTextRange } from './bookTextRange';
import { mergeBookText } from './mergeBookText';
import { moveBookSelection, resizeBookSelection } from './bookBlockSelection';
import { bookAudioText } from '@shared/bookAudioBlock';

const block = (id: string, text: string): WritingBlock => ({ id, text, format: 'text', parentId: null, collapsed: false });
const blocks = [block('a', '我们接住情绪。'), block('b', 'Whatever you feel.'), block('c', '后文')];
const range = { anchor: { id: 'a', offset: 2 }, focus: { id: 'b', offset: 8 } };

describe('continuous text selection between book modules', () => {
  it('keeps exact partial endpoints in either direction and copies one paragraph separator', () => {
    const parts = bookTextRangeParts(blocks, range);
    expect(parts.map(p => p.text.slice(p.start, p.end)).join('\n')).toBe('接住情绪。\nWhatever');
    expect(bookTextRangeParts(blocks, { anchor: range.focus, focus: range.anchor })).toEqual(parts);
  });
  it('preserves empty paragraphs, internal newlines and repeated text', () => {
    const source = [block('a', '甲\n乙'), block('b', ''), block('c', '甲\n乙')];
    const parts = bookTextRangeParts(source, { anchor: {id:'a',offset:1}, focus: {id:'c',offset:3} });
    expect(parts.map(p => p.text.slice(p.start,p.end)).join('\n')).toBe('\n乙\n\n甲\n乙');
  });
  it('moves and resizes selected modules through the existing group operations', () => {
    const ids = bookTextRangeParts(blocks, range).map(p => p.id);
    expect(moveBookSelection(blocks, ids, { id: 'c', position: 'after' }).map(b => b.id)).toEqual(['c','a','b']);
    const larger = resizeBookSelection(blocks, ids, 1.5);
    expect(larger.slice(0,2).map(b => b.book?.fontSize)).toEqual([36,36]);
    expect(larger[2]).toBe(blocks[2]);
  });
  it('merges whole selected modules without dropping partial endpoint text or line breaks', () => {
    const merged = mergeBookText(blocks, bookTextRangeParts(blocks, range).map(p => p.id));
    expect(blockBody(merged)).toBe(blockBody(blocks));
    expect(merged.map(b => b.id)).toEqual(['a','c']);
    expect(restoreStyledBlocks(blockBody(merged), writingStyleOf(merged))).toEqual(merged);
  });
  it('replaces only selected characters and preserves the first identity and untouched blocks', () => {
    const result = replaceBookTextRange(blocks, range, '好')!;
    expect(blockBody(result.blocks)).toBe('我们好 you feel.\n后文');
    expect(result.position).toBe(3);
    expect(result.blocks[0].id).toBe('a');
    expect(result.blocks[1]).toBe(blocks[2]);
    expect(blockBody(blocks)).toBe('我们接住情绪。\nWhatever you feel.\n后文');
  });
  it('pastes multiple lines without dropping empty lines or the final suffix', () => {
    const result = replaceBookTextRange(blocks, range, '甲\r\n\r\n乙')!;
    expect(blockBody(result.blocks)).toBe('我们甲\n\n乙 you feel.\n后文');
    expect(result.position).toBe(6);
    expect(restoreStyledBlocks(blockBody(result.blocks), writingStyleOf(result.blocks))).toEqual(result.blocks);
  });
  it('does not leave orphan children when selected heading text is replaced', () => {
    const source = [block('a','前'), {...block('h','标题'),format:'heading1' as const}, {...block('c','孩子'),parentId:'h'}];
    const result = replaceBookTextRange(source, {anchor:{id:'a',offset:1},focus:{id:'h',offset:1}}, '')!;
    expect(result.blocks.find(b => b.id === 'c')?.parentId).toBeNull();
    expect(restoreStyledBlocks(blockBody(result.blocks),writingStyleOf(result.blocks))).toEqual(result.blocks);
  });
  it('clamps at images, audio and folded text instead of silently including them', () => {
    for (const middle of [block('m','![图](https://example.com/a.png)'), block('m',bookAudioText(1,2,'配乐')), block('m','隐藏正文')]) {
      const source = [blocks[0],middle,blocks[1]];
      expect(clampBookTextFocus(source,new Set(['a','b']),range.anchor,range.focus)).toEqual({id:'a',offset:7});
      expect(clampBookTextFocus(source,new Set(['a','b']),range.focus,range.anchor)).toEqual({id:'b',offset:0});
    }
  });
  it('rejects replacement across a media reference even if given stale range endpoints', () => {
    const source = [blocks[0],block('m',bookAudioText(1,2,'配乐')),blocks[1]];
    expect(replaceBookTextRange(source,range,'')).toBeNull();
  });
  it('rejects stale endpoints without changing the document', () => {
    expect(replaceBookTextRange(blocks,{...range,focus:{id:'gone',offset:1}},'x')).toBeNull();
  });
});
