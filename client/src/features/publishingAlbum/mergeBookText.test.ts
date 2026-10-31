import {expect,it} from 'vitest';
import {mergeBookText} from './mergeBookText';
import {newWritingBlock,restoreStyledBlocks,writingStyleOf,blockBody} from './chapterBlockTree';
it('merges in document order, keeps other blocks and survives saving/reload',()=>{
 const blocks=['甲','乙','丙'].map(t=>newWritingBlock(t));
 const result=mergeBookText(blocks,[blocks[2].id,blocks[0].id]);
 expect(result.map(b=>b.text)).toEqual(['甲\n丙','乙']);expect(blocks[0].text).toBe('甲');
 expect(restoreStyledBlocks(blockBody(result),writingStyleOf(result)).map(b=>b.text)).toEqual(['甲\n丙','乙']);
});
it('refuses mixed media and lifts children of merged headings without losing them',()=>{
 const title={...newWritingBlock('章'),format:'heading1' as const};const child=newWritingBlock('子段',title.id);const last=newWritingBlock('末尾');
 const result=mergeBookText([title,child,last],[title.id,last.id]);expect(result[0].format).toBe('text');expect(result[1].parentId).toBe(null);expect(result[1].text).toBe('子段');
 const image=newWritingBlock('![图片](/api/images/a.png)');const blocks=[child,image];expect(mergeBookText(blocks,blocks.map(b=>b.id))).toBe(blocks);
});

it('preserves empty lines, validates saved boundaries and positions following modules correctly',async()=>{
 const {validWritingStyle,sameWritingStyle,writingModuleTexts,bookWritingStyleSchema}=await import('@shared/bookWritingStyle');
 const {writingBlockOffset,writingBlockPosition,splitWritingBlock}=await import('./chapterBlockTree');
 const blocks=['第一行\n\n第三行','第二段','后面的模块'].map(t=>newWritingBlock(t));
 const merged=mergeBookText(blocks,blocks.slice(0,2).map(b=>b.id));
 expect(merged[0].text).toBe('第一行\n\n第三行\n第二段');
 const body=blockBody(merged),style=bookWritingStyleSchema.parse(writingStyleOf(merged));
 expect(validWritingStyle(body,style)).toBe(true);
 expect(sameWritingStyle(style,style.map(({lineCount,...rest})=>rest))).toBe(false);
 expect(writingModuleTexts(body,style)).toEqual(merged.map(b=>b.text));
 expect(restoreStyledBlocks(body,style)).toEqual(merged);
 expect(writingBlockPosition(merged,writingBlockOffset(merged,1)+2)).toEqual({index:1,cursor:2});
 const split=splitWritingBlock(merged,0,4,4);
 expect(split.blocks[1].text).toBe('\n第三行\n第二段');
});
