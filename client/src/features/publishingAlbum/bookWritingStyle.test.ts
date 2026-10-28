import { sameWritingStyle, bookWritingStyleSchema } from '@shared/bookWritingStyle';
import { expect, it } from 'vitest';
import { restoreStyledBlocks, writingStyleOf } from './chapterBlockTree';
import { restoreChapterWritingDraft, draftNeedsVersionReview } from './chapterWritingDraft';
const style=[{id:'a',format:'heading1' as const,parentId:null,collapsed:true},{id:'b',format:'text' as const,parentId:'a',collapsed:false,emphasis:'bright' as const,backdrop:true}];
it('restores styles and hierarchy without any local browser metadata',()=>{
 const blocks=restoreStyledBlocks('Title\nText',style);
 expect(blocks[0]).toMatchObject({format:'heading1',collapsed:true});
 expect(blocks[1]).toMatchObject({parentId:'a',emphasis:'bright',backdrop:true});
 expect(writingStyleOf(blocks)).toEqual(style);
});
it('format-only drafts keep their old base and cannot silently overwrite newer formatting',()=>{
 const saved={title:'Book',body:'Title\nText',version:9,writingStyle:style};
 const changed=style.map(row=>({...row,collapsed:false}));
 const draft=restoreChapterWritingDraft(JSON.stringify({...saved,baseVersion:8,writingStyle:changed}),saved);
 expect(draft.baseVersion).toBe(8); expect(draftNeedsVersionReview(draft,saved)).toBe(true);
});
it('a matching legacy text draft inherits server formatting but changed text does not',()=>{
 const saved={title:'Book',body:'Title\nText',version:9,writingStyle:style};
 expect(restoreChapterWritingDraft(JSON.stringify({title:'Book',body:saved.body}),saved).writingStyle).toEqual(style);
 expect(restoreChapterWritingDraft(JSON.stringify({title:'Book',body:'Different'}),saved).writingStyle).toBeUndefined();
});

it('treats server-normalized key order and default styling as the same saved version',()=>{
 const editor=[{parentId:null,id:'a',collapsed:false,format:'text' as const,book:{rect:{width:300,height:80,x:10,y:20},fontSize:24,page:0}}];
 const server=bookWritingStyleSchema.parse(editor);
 expect(sameWritingStyle(editor,server)).toBe(true);
 expect(sameWritingStyle(editor,[{...server[0],emphasis:'normal',backdrop:false}])).toBe(true);
 expect(sameWritingStyle(editor,[{...server[0],book:{...server[0].book!,fontSize:25}}])).toBe(false);
});
