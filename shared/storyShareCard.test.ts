import {describe,expect,it} from "vitest";

import {cardDescriptorSchema,cardSelectionSchema} from "./storyShareCard";

const blockId=`block-${"a".repeat(64)}`;
const selection={revisionId:"revision-current",chapterId:"chapter-one",blockIds:[blockId],photoIds:[]};
const descriptor={id:`card-${"b".repeat(64)}`,version:1 as const,storyId:"story-one",revisionId:"revision-current",storyVersion:1,
  chapterId:"chapter-one",title:"夏天",chapterTitle:"第一章",byline:"拾光",paragraphs:["记忆"],photos:[]};

describe("故事卡共享契约",()=>{
  it("接受与权威故事一致的照片编号上限，并拒绝重复选择",()=>{
    expect(cardSelectionSchema.safeParse({...selection,photoIds:[`photo-${"a".repeat(120)}`]}).success).toBe(true);
    expect(cardSelectionSchema.safeParse({...selection,blockIds:[blockId,blockId]}).success).toBe(false);
    expect(cardSelectionSchema.safeParse({...selection,photoIds:["photo-a","photo-a"]}).success).toBe(false);
  });

  it("按所有段落合计执行 1200 字符预算",()=>{
    expect(cardDescriptorSchema.safeParse({...descriptor,paragraphs:["甲".repeat(600),"乙".repeat(600)]}).success).toBe(true);
    expect(cardDescriptorSchema.safeParse({...descriptor,paragraphs:["甲".repeat(600),"乙".repeat(601)]}).success).toBe(false);
  });
});
