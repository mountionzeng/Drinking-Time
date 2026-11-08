import { describe, expect, it } from 'vitest';
import { bookBlockNumbers, bookBlockNumberLabel } from '@shared/bookBlockNumbering';
import { bookWritingStyleSchema, validWritingStyle } from '@shared/bookWritingStyle';
import { bookAudioText } from '@shared/bookAudioBlock';
import { layoutBookBlocks, moveBookBlockByKey, findBookDrop } from './bookBlockLayout';
import { moveBookSelection, selectedBookIds } from './bookBlockSelection';
import { blockBody, insertBlockText, mergeWritingBlocks, moveWritingBlock, restoreWritingBlocks, restoreStyledBlocks, writingStyleOf, splitWritingBlock, setBlockFormat, type WritingBlock } from './chapterBlockTree';
const b = (id: string, text: string, parentId: string | null = null, heading = false): WritingBlock => ({ id, text, parentId, format: heading ? 'heading2' : 'text', collapsed: false });
const sample = () => [b('h', '标题', null, true), b('a', '段落甲', 'h'), b('b', '段落乙', 'h'), b('outside', '外部正文')];
const storyboard = (): WritingBlock[] => [
  {...b('s1','自写场景名'),format:'scene'},
  {...b('a1','近景','s1'),format:'shot'}, b('text','只有文字也可以','a1'),
  {...b('a2','远景','s1'),format:'shot'},
  {...b('s2','另一个场景'),format:'scene'},
  {...b('b1','第一镜','s2'),format:'shot'}, {...b('b2','第二镜','s2'),format:'shot'},
  {...b('b3','用户镜头标题','s2'),format:'shot'},
  b('image1','![图片](/api/images/one.png)','b3'),b('image2','![图片](/api/images/two.png)','b3'),
  {...b('dialogue','你好\n再见','b3'),videoRole:'dialogue'},
  b('audio',bookAudioText(4,7,'雨声'),'b3'), b('description','镜头向窗外移动','b3'),
];
describe('scene and shot modules',()=>{
  it.each([['scene', 'shot'], ['heading1', 'heading2']] as const)('keeps %s/%s conversion and moves hierarchical with complete children', (parent, child) => {
    const rows: WritingBlock[] = [
      {...b('p1', '一'), format: parent}, {...b('c1', '甲', 'p1'), format: child}, b('body', '正文', 'c1'),
      {...b('p2', '二'), format: parent}, {...b('c2', '乙', 'p2'), format: child}, b('image', '![图片](/api/images/a.png)', 'c2'),
    ];
    expect(moveWritingBlock(rows, 'p2', 'p1', 'inside')).toBe(rows);
    expect(moveWritingBlock(rows, 'c2', 'c1', 'inside')).toBe(rows);
    expect(setBlockFormat(rows, 0, child)).toBe(rows);
    for (const next of [moveWritingBlock(rows, 'c2', 'p1', 'before'), moveBookSelection(rows, ['c2'], {id:'p1',position:'before'})]) {
      expect(next.map(b => b.id)).toEqual(['p1','c2','image','c1','body','p2']);
      expect(next[1].parentId).toBe('p1');
      expect(validWritingStyle(blockBody(next), writingStyleOf(next))).toBe(true);
    }
    const entered = [...rows, b('new', '新标题', 'c2')];
    const sibling = setBlockFormat(entered, 6, child);
    expect(sibling.find(b => b.id === 'new')?.parentId).toBe('p2');
    const promoted = setBlockFormat(sibling, 6, parent);
    expect(promoted.find(b => b.id === 'new')?.parentId).toBeNull();
    const afterFold = [...rows.map(b => b.id === 'p2' ? {...b,collapsed:true} : b), b('new', '新标题')];
    expect(setBlockFormat(afterFold, 6, child).find(b => b.id === 'new')?.parentId).toBe('p2');
    const demoted = [...rows, {...b('p3', '改为下级'), format:parent}];
    expect(setBlockFormat(demoted, 6, child).find(b => b.id === 'p3')?.parentId).toBe('p2');
  });
  it('keeps shot keyboard movement at sibling level and refuses nested shots/scenes',()=>{
    const before=storyboard();
    const next=moveBookBlockByKey(before,'a2','ArrowUp');
    expect(next.slice(0,4).map(row=>row.id)).toEqual(['s1','a2','a1','text']);
    expect(next.find(row=>row.id==='a2')?.parentId).toBe('s1');
    expect(moveWritingBlock(before,'b3','a1','inside')).toBe(before);
    expect(moveBookSelection(before,['s2'],{id:'s1',position:'inside'})).toBe(before);
    expect(setBlockFormat(before,0,'shot')).toBe(before);
    expect(findBookDrop(before,'b3',[{id:'a1',top:0,bottom:100}],40)?.position).toBe('before');
  });
  it('moves scene two shot three with every asset to scene one slot two and derives a new label',()=>{
    const before=storyboard();
    expect(bookBlockNumberLabel(bookBlockNumbers(before).get('b3')!)).toBe('二场三镜');
    for(const next of [moveWritingBlock(before,'b3','a2','before'),moveBookSelection(before,['b3'],{id:'a2',position:'before'})]) {
      expect(bookBlockNumberLabel(bookBlockNumbers(next).get('b3')!)).toBe('一场二镜');
      expect(next.slice(3,9).map(row=>row.id)).toEqual(['b3','image1','image2','dialogue','audio','description']);
      expect(next.find(row=>row.id==='b3')).toMatchObject({text:'用户镜头标题',parentId:'s1'});
      for(const id of ['image1','image2','dialogue','audio','description']) expect(next.find(row=>row.id===id)).toEqual(before.find(row=>row.id===id));
      const style=bookWritingStyleSchema.parse(writingStyleOf(next));
      expect(validWritingStyle(blockBody(next),style)).toBe(true);
      expect(restoreStyledBlocks(blockBody(next),style)).toEqual(next);
    }
  });
  it('folds and moves complete scene/shot trees without removing content',()=>{
    const before=storyboard(), collapsed=before.map(row=>row.id==='b3'?{...row,collapsed:true}:row);
    expect(layoutBookBlocks(collapsed).map(row=>row.block.id)).not.toContain('image1');
    expect(selectedBookIds(collapsed,['b3']).size).toBe(6);
    const moved=moveBookSelection(collapsed,['s2'],{id:'s1',position:'before'});
    expect(moved.slice(0,9).map(row=>row.id)).toEqual(before.slice(4).map(row=>row.id));
    expect(bookBlockNumberLabel(bookBlockNumbers(moved).get('b3')!)).toBe('一场三镜');
    expect(restoreStyledBlocks(blockBody(moved),writingStyleOf(moved))).toEqual(moved);
  });
  it('converts newly entered titles into sibling shots and scenes, retaining descendants',()=>{
    const before=storyboard();
    const entered=splitWritingBlock(before,12,before[12].text.length,before[12].text.length);
    const id=entered.blocks[entered.insertedIndex].id;
    const shot=setBlockFormat(entered.blocks,entered.insertedIndex,'shot');
    expect(shot.find(row=>row.id===id)).toMatchObject({format:'shot',parentId:'s2'});
    expect(bookBlockNumberLabel(bookBlockNumbers(shot).get(id)!)).toBe('二场四镜');
    const scene=setBlockFormat(shot,shot.findIndex(row=>row.id===id),'scene');
    expect(scene.find(row=>row.id===id)).toMatchObject({format:'scene',parentId:null});
    expect(validWritingStyle(blockBody(scene),writingStyleOf(scene))).toBe(true);
  });
  it('numbers manual and imported chapters together, resetting sections by chapter',()=>{
    const rows=[{...b('c1','原标题'),format:'heading1' as const},{...b('t1','节','c1'),format:'heading2' as const},
      {...b('c2','微信标题'),format:'heading1' as const},{...b('t2','节','c2'),format:'heading2' as const}];
    expect([...bookBlockNumbers(rows).values()].map(n=>bookBlockNumberLabel(n))).toEqual(['第一章','第一节','第二章','第一节']);
    expect(blockBody(rows)).toBe('原标题\n节\n微信标题\n节');
  });
});
describe('explicit local writing block hierarchy', () => {
  it('persists dialogue classification through save, restore, typing and splitting; normal text clears it',()=>{
    const blocks=[{...b('a','第一句\n第二句'),videoRole:'dialogue' as const}];
    expect(restoreStyledBlocks(blockBody(blocks),writingStyleOf(blocks))[0].videoRole).toBe('dialogue');
    expect(insertBlockText(blocks,0,'第一句\n下一句').blocks.every(b=>b.videoRole==='dialogue')).toBe(true);
    expect(splitWritingBlock(blocks,0,3,3).blocks.every(b=>b.videoRole==='dialogue')).toBe(true);
    expect(setBlockFormat(blocks,0,'text')[0].videoRole).toBeUndefined();
  });
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
