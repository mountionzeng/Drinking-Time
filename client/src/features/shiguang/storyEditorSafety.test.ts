import {describe,expect,it} from "vitest";

import {clearStoryDraftRecovery,isWriteReconciled,readStoryDraftRecovery,writeStoryDraftRecovery} from "./storyEditorSafety";
import {createEditorDraft,updateDraftBlock,type StoryDocument} from "./storyDocument";

const story:StoryDocument={familyId:"family_owner",storyId:"story-summer",revisionId:"revision-8",version:8,title:"夏天",updatedAt:"2026-09-18T06:00:00.000Z",provenanceVersion:1,
  chapters:[{id:"chapter-one",title:"第一章",content:[{text:"原文",blockId:"block-"+"a".repeat(64),sourceIds:[]}]}]};
const storage=()=>{const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};};

describe("电脑故事编辑安全状态",()=>{
  it("只有重新读取到写入回执对应的修订和版本才算保存确认",()=>{
    const receipt={storyId:"story-summer",revisionId:"revision-9",version:9};
    expect(isWriteReconciled(receipt,{...story,revisionId:"revision-9",version:9})).toBe(true);
    expect(isWriteReconciled(receipt,story)).toBe(false);
    expect(isWriteReconciled(receipt,{...story,storyId:"story-other",revisionId:"revision-9",version:9})).toBe(false);
  });

  it("离开页面后可恢复未保存的基础版本和草稿，保存后可清除",()=>{
    const session=storage(),draft=updateDraftBlock(createEditorDraft(story),"block-"+"a".repeat(64),"不能丢的本地文字");
    writeStoryDraftRecovery(session,4,story,draft);
    expect(readStoryDraftRecovery(session,4)).toEqual({base:story,draft});
    expect(readStoryDraftRecovery(session,5)).toBeNull();
    clearStoryDraftRecovery(session,4);
    expect(readStoryDraftRecovery(session,4)).toBeNull();
  });

  it("损坏或身份不一致的缓存失败关闭",()=>{
    const session=storage();session.setItem("shiguang-story-draft:4","{bad");expect(readStoryDraftRecovery(session,4)).toBeNull();
    session.setItem("shiguang-story-draft:4",JSON.stringify({accessId:5,base:story,draft:createEditorDraft(story)}));
    expect(readStoryDraftRecovery(session,4)).toBeNull();
  });
});
