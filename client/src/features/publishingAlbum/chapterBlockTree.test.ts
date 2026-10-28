import { describe, expect, it } from 'vitest';
import { blockBody, insertBlockText, mergeWritingBlocks, moveWritingBlock, restoreWritingBlocks, setBlockFormat, type WritingBlock } from './chapterBlockTree';
const b = (id: string, text: string, parentId: string | null = null, heading = false): WritingBlock => ({ id, text, parentId, format: heading ? 'heading2' : 'text', collapsed: false });
const sample = () => [b('h', '标题', null, true), b('a', '段落甲', 'h'), b('b', '段落乙', 'h'), b('outside', '外部正文')];
describe('explicit local writing block hierarchy', () => {
  it('creates text inside an expanded heading, before existing children', () => {
    const result = insertBlockText(sample(), 0, '标题\n新文字');
    expect(result.insertedIndex).toBe(1);
    expect(result.blocks[1]).toMatchObject({ text: '新文字', parentId: 'h', format: 'text' });
    expect(result.blocks.slice(2).map(block => block.id)).toEqual(['a', 'b', 'outside']);
  });
  it('creates text outside a collapsed heading, after its entire subtree', () => {
    const blocks = sample(); blocks[0].collapsed = true;
    const result = insertBlockText(blocks, 0, '标题\n新文字');
    expect(result.insertedIndex).toBe(3);
    expect(result.blocks[3]).toMatchObject({ text: '新文字', parentId: null });
    expect(result.blocks[0].collapsed).toBe(true);
    expect(result.blocks.slice(1, 3).map(block => block.text)).toEqual(['段落甲', '段落乙']);
  });
  it('inserts a sibling of a collapsed nested title within its outer heading', () => {
    const blocks = [b('outer', '大标题', null, true), b('inner', '小标题', 'outer', true), b('x', '内部', 'inner')];
    blocks[1].collapsed = true;
    const result = insertBlockText(blocks, 1, '小标题\n后续');
    expect(result.blocks[3].parentId).toBe('outer');
  });
  it('moves text into a closed title and reveals the moved block', () => {
    const blocks = sample(); blocks[0].collapsed = true;
    const next = moveWritingBlock(blocks, 'outside', 'h', 'inside');
    expect(next[3]).toMatchObject({ id: 'outside', parentId: 'h' });
    expect(next[0].collapsed).toBe(false);
    expect(blocks[0].collapsed).toBe(true);
  });
  it('moves a heading together with all children', () => {
    const next = moveWritingBlock(sample(), 'h', 'outside', 'after');
    expect(next.map(block => block.id)).toEqual(['outside', 'h', 'a', 'b']);
    expect(next[2].parentId).toBe('h');
  });
  it('moving text out puts it after its parent subtree', () => {
    const next = moveWritingBlock(sample(), 'a', 'h', 'after');
    expect(next.map(block => block.id)).toEqual(['h', 'b', 'a', 'outside']);
    expect(next[2].parentId).toBeNull();
  });
  it('prevents moving a title into itself or one of its descendants', () => {
    const blocks = sample();
    expect(moveWritingBlock(blocks, 'h', 'a', 'before')).toBe(blocks);
    expect(moveWritingBlock(blocks, 'h', 'h', 'inside')).toBe(blocks);
  });
  it('keeps empty and repeated paragraphs distinct when reordered', () => {
    const blocks = [b('a', '同文'), b('blank', ''), b('b', '同文')];
    const next = moveWritingBlock(blocks, 'b', 'a', 'before');
    expect(next.map(block => block.id)).toEqual(['b', 'a', 'blank']);
    expect(blockBody(next)).toBe('同文\n同文\n');
  });
  it('turning a heading into text lifts children without losing text', () => {
    const before = sample(); const next = setBlockFormat(before, 0, 'text');
    expect(next.every(block => block.parentId === null)).toBe(true);
    expect(blockBody(next)).toBe(blockBody(before));
  });
  it('never merges across a title boundary or into hidden children', () => {
    const blocks = sample(); blocks[0].collapsed = true;
    expect(mergeWritingBlocks(blocks, 0)).toBe(blocks);
    expect(mergeWritingBlocks(blocks, 2)).toBe(blocks);
    expect(mergeWritingBlocks(blocks, 1)[1].text).toBe('段落甲段落乙');
  });
  it('restores local hierarchy and collapse only for the matching body', () => {
    const blocks = sample(); blocks[0].collapsed = true;
    expect(restoreWritingBlocks(blockBody(blocks), { body: blockBody(blocks), blocks })).toEqual(blocks);
    expect(restoreWritingBlocks('别的版本', { body: blockBody(blocks), blocks })[0]).toMatchObject({ text: '别的版本', parentId: null, format: 'text' });
  });
  it('upgrades the prior implicit heading ranges', () => {
    const blocks = restoreWritingBlocks('大标题\n甲\n小标题\n乙\n另一大标题', { body: '大标题\n甲\n小标题\n乙\n另一大标题', formats: { 0: 'heading1', 2: 'heading2', 4: 'heading1' } });
    expect(blocks[1].parentId).toBe(blocks[0].id);
    expect(blocks[2].parentId).toBe(blocks[0].id);
    expect(blocks[3].parentId).toBe(blocks[2].id);
    expect(blocks[4].parentId).toBeNull();
  });
});
