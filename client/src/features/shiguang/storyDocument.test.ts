import {describe,expect,it} from "vitest";
import {appendOwnDraftBlock,buildWriteEdits,createEditorDraft,draftHasChanges,rebaseEditorDraft,removeOwnDraftBlock,updateDraftBlock,type StoryDocument} from "./storyDocument";

const document=(version=3):StoryDocument=>({familyId:"family_owner",storyId:"story-summer",revisionId:`revision-${version}`,version,title:"夏天",updatedAt:"2026-09-18T06:00:00.000Z",provenanceVersion:1,
  chapters:[{id:"chapter-one",title:"第一章",content:[{text:"原文",blockId:"block-"+"a".repeat(64),sourceIds:["source-"+"b".repeat(64)]},{photoId:"photo-kept",blockId:"block-"+"c".repeat(64),sourceIds:[]}]}]});

describe("跨端故事文档草稿",()=>{
  it("只产生文字区块操作，不上传来源、照片或整本稿",()=>{
    const base=document(),changed=updateDraftBlock(createEditorDraft(base),"block-"+"a".repeat(64),"修改后");
    const edits=buildWriteEdits(base,changed);expect(edits).toEqual([{action:"edit",blockId:"block-"+"a".repeat(64),text:"修改后"}]);
    expect(JSON.stringify(edits)).not.toContain("source-");expect(JSON.stringify(edits)).not.toContain("photo-kept");
  });
  it("本人补充有独立临时身份，空补充和删除不会提交",()=>{
    const base=document(),added=appendOwnDraftBlock(createEditorDraft(base),"chapter-one","local-1");
    expect(draftHasChanges(base,added)).toBe(false);
    const written=updateDraftBlock(added,"local-1","我的补充");expect(buildWriteEdits(base,written)).toEqual([{action:"appendOwn",chapterId:"chapter-one",text:"我的补充"}]);
    expect(draftHasChanges(base,removeOwnDraftBlock(written,"local-1"))).toBe(false);
  });
  it("冲突重放基于最新结构，保留仍存在区块的本地文字和本人补充",()=>{
    const old=document(),local=updateDraftBlock(appendOwnDraftBlock(createEditorDraft(old),"chapter-one","local-1"),"block-"+"a".repeat(64),"本地修改");
    const withAddition=updateDraftBlock(local,"local-1","本地补充"),next=document(4);next.chapters[0].content.push({text:"别人新增",blockId:"block-"+"d".repeat(64),sourceIds:[]});
    const rebased=rebaseEditorDraft(old,next,withAddition);expect(rebased?.chapters[0].content.map(block=>block.text||block.photoId)).toEqual(["本地修改","photo-kept","别人新增","本地补充"]);
    expect(buildWriteEdits(next,rebased!)).toEqual([{action:"edit",blockId:"block-"+"a".repeat(64),text:"本地修改"},{action:"appendOwn",chapterId:"chapter-one",text:"本地补充"}]);
  });
  it("冲突重放只覆盖本地真正改过的段落，保留远端对其他段落的更新",()=>{
    const old=document();old.chapters[0].content.push({text:"旧的第二段",blockId:"block-"+"d".repeat(64),sourceIds:[]});
    const local=updateDraftBlock(createEditorDraft(old),"block-"+"a".repeat(64),"本地修改");
    const next=document(4);next.chapters[0].content.push({text:"远端新的第二段",blockId:"block-"+"d".repeat(64),sourceIds:[]});
    const rebased=rebaseEditorDraft(old,next,local);
    expect(rebased?.chapters[0].content.map(block=>block.text||block.photoId)).toEqual(["本地修改","photo-kept","远端新的第二段"]);
    expect(buildWriteEdits(next,rebased!)).toEqual([{action:"edit",blockId:"block-"+"a".repeat(64),text:"本地修改"}]);
  });
  it("同一段双方都改过或本地补充所属章节消失时停止重放并保留原草稿",()=>{
    const old=document(),local=updateDraftBlock(createEditorDraft(old),"block-"+"a".repeat(64),"本地修改"),next=document(4);
    next.chapters[0].content[0]={...next.chapters[0].content[0],text:"远端修改"};
    expect(rebaseEditorDraft(old,next,local)).toBeNull();
    const withAddition=updateDraftBlock(appendOwnDraftBlock(createEditorDraft(old),"chapter-one","local-1"),"local-1","不能丢的补充");
    expect(rebaseEditorDraft(old,{...next,chapters:[]},withAddition)).toBeNull();
  });
});
