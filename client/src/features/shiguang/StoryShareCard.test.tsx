import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {StoryCardSelection} from './StoryShareCard';
import {wrapCardText} from './storyCardCanvas';
import {cardMaterialSchema,type CardSource} from '../../../../shared/storyShareCard';

describe('故事卡片',()=>{
  it('明确区分可发布、无发布许可及未选章节，不展示私人链接',()=>{
    const source:CardSource={story:{id:'story-a',title:'夏日',version:1},revisionId:'revision-a',chapters:[
      {id:'chapter-a',title:'第一章',blocks:[{blockId:'block-'+'a'.repeat(64),kind:'text',preview:'可以发布的记忆',publishable:true},
        {blockId:'block-'+'b'.repeat(64),kind:'text',preview:'亲友的段落',publishable:false}]},
      {id:'chapter-b',title:'第二章',blocks:[{blockId:'block-'+'c'.repeat(64),kind:'text',preview:'不要出现在预览里',publishable:true}]}]};
    const html=renderToStaticMarkup(<StoryCardSelection source={source} chapterId="chapter-a" selected={['block-'+'a'.repeat(64)]} busy={false} onChapter={()=>{}} onToggle={()=>{}}/>);
    expect(html).toContain('没有公开发布许可');expect(html).toContain('checked=""');expect(html).toContain('disabled=""');
    expect(html).not.toContain('不要出现在预览里');expect(html).not.toContain('cloud://');
  });
  it('中文与 emoji 不拆代理对，保留换行且不丢末尾文字',()=>{
    expect(wrapCardText('一家👨‍👩‍👧\n末尾',value=>Array.from(value).length,3).join('')).toBe('一家👨‍👩‍👧末尾');
    expect(wrapCardText('中文测试',value=>value.length,2)).toEqual(['中文','测试']);
    expect(wrapCardText('甲\n\n乙',value=>value.length,10)).toEqual(['甲','','乙']);
  });
  it('材料拒绝不安全地址及未知私密字段',()=>{
    const descriptor={id:'card-'+'a'.repeat(64),version:1,storyId:'story-a',revisionId:'revision-a',storyVersion:1,chapterId:'chapter-a',title:'夏日',chapterTitle:'第一章',byline:'拾光',paragraphs:['记忆'],photos:[]};
    expect(cardMaterialSchema.safeParse({descriptor,media:[]}).success).toBe(true);
    expect(cardMaterialSchema.safeParse({descriptor:{...descriptor,privateLink:'secret'},media:[]}).success).toBe(false);
    for(const url of ['http://example.com/a.jpg','https://user:secret@example.com/a.jpg','data:image/png,xxx'])
      expect(cardMaterialSchema.safeParse({descriptor,media:[{photoId:'photo-a',url,requestedMaxAgeSeconds:300}]}).success).toBe(false);
  });
});
