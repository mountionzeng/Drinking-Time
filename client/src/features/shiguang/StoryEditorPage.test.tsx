import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,expect,it,vi} from "vitest";
import {StoryEditorView,StoryPhotoView} from "./StoryEditorPage";
import {createEditorDraft,type StoryDocument} from "./storyDocument";

const story:StoryDocument={familyId:"family_owner",storyId:"story-summer",revisionId:"revision-current",version:8,title:"那年的夏天",updatedAt:"2026-09-18T06:00:00.000Z",provenanceVersion:1,
  chapters:[{id:"chapter-one",title:"第一章",content:[{text:"院子里有一棵树",blockId:"block-"+"a".repeat(64),sourceIds:[]},{photoId:"photo-kept",blockId:"block-"+"b".repeat(64),sourceIds:[]}]}]};
const props={accesses:[{id:4,title:"那年的夏天",status:"active" as const}],selectedAccessId:4,document:story,draft:createEditorDraft(story),loading:false,dirty:true,saving:false,
  onSelect:vi.fn(),onChange:vi.fn(),onAppend:vi.fn(),onRemove:vi.fn(),onSave:vi.fn(),onRebase:vi.fn()};

describe("拾光电脑故事编辑页",()=>{
  it("shows the current authoritative version, editable text and a non-destructive photo placeholder",()=>{
    const html=renderToStaticMarkup(<StoryEditorView {...props}/>);expect(html).toContain("那年的夏天");expect(html).toContain("第 8 版");
    expect(html).toContain("院子里有一棵树");expect(html).toContain("照片保留在这一段");expect(html).toContain("有未保存修改");expect(html).not.toContain("family_owner");
  });
  it("keeps local copy visible during a conflict and exposes an explicit rebase action",()=>{
    const latest={...story,version:9,revisionId:"revision-next"};const html=renderToStaticMarkup(<StoryEditorView {...props} conflict={latest} error="故事已有更新，你的修改仍保留在当前页面。"/>);
    expect(html).toContain("已经保存到第 9 版");expect(html).toContain("你的文字仍保留");expect(html).toContain("基于最新版继续");
  });
  it("has a useful empty state instead of opening another product workspace",()=>{
    const html=renderToStaticMarkup(<StoryEditorView {...props} accesses={[]} selectedAccessId={undefined} document={undefined} draft={undefined} dirty={false}/>);
    expect(html).toContain("还没有已连接的故事");expect(html).toContain("选择一本故事继续");
  });
  it("renders a short-lived authorized photo with a privacy-preserving fallback",()=>{
    const photo=renderToStaticMarkup(<StoryPhotoView url="https://media.example/temporary.jpg?token=short" loading={false} failed={false}/>);
    expect(photo).toContain("故事照片");expect(photo).toContain("临时受控读取");expect(photo).toContain("no-referrer");
    const unavailable=renderToStaticMarkup(<StoryPhotoView loading={false} failed={true}/>);expect(unavailable).toContain("照片暂时无法显示");
  });
});
