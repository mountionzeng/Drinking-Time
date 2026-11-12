import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { UiLanguageContext } from "@/features/uiLanguage/UiLanguage";
import { ChatFrameReferences } from "./ChatFrameReferences";
import { storyboardShotFrameImages } from "./storyboardReviewModel";
import type { CreationEditorShot } from "@/features/creationEditor/types";

it("shows a selectable source frame with shot/time and English copy, without adoption controls", () => {
  vi.stubGlobal("React", React);
  const frame = { storyId: 7, stableShotId: "third", shotNo: 3, imageId: 55, imageUrl: "/api/images/ref.png", takeId: 10, timelineFrame: 616, shotTimeSec: 2.1667, sourceTimeSec: 4.1667 };
  const html = renderToStaticMarkup(<UiLanguageContext.Provider value={{language:"en",setLanguage:()=>{}}}><ChatFrameReferences frames={[frame]} storyId={7} onSelect={()=>{}} selectedImageId={55}/></UiLanguageContext.Provider>);
  expect(html).toContain("Shot 03"); expect(html).toContain("2.17"); expect(html).toContain('aria-pressed="true"'); expect(html).not.toContain("替换"); expect(html).not.toContain("视频参考帧");
  const foreign = renderToStaticMarkup(<ChatFrameReferences frames={[frame]} storyId={8} onSelect={()=>{}}/>);
  expect(foreign).toContain('disabled=""');
  vi.unstubAllGlobals();
});

it("does not turn video references into implicit first/last frames; explicit use still works", () => {
  const shot = { shotNo: 3, stableShotId: "third", imageVersions: [{id:55,imageUrl:"/api/images/ref.png",referenceOnly:true,shotNo:3,isCurrent:false}], generationParams:"{}" } as CreationEditorShot;
  expect(storyboardShotFrameImages(shot)).toEqual([]);
  shot.generationParams=JSON.stringify({storyboardFrameRoles:{firstImageId:null,lastImageId:null,referenceImageIds:[55]}});
  expect(storyboardShotFrameImages(shot).map(image=>image.id)).toEqual([55]);
});

it("keeps paused references collapsed with exact provenance and fully English labels", () => {
  vi.stubGlobal("React", React);
  const frame={storyId:7,stableShotId:"third",shotNo:3,imageId:99,imageUrl:"/api/images/ref.png",origin:"paused-preview" as const,timelineVersion:16,timelineFrame:90,sourceTimeSec:3,shotTimeSec:3};
  const html=renderToStaticMarkup(<UiLanguageContext.Provider value={{language:"en",setLanguage:()=>{}}}><ChatFrameReferences frames={[frame]} storyId={7} onSelect={()=>{}} /></UiLanguageContext.Provider>);
  expect(html).toContain("<details");expect(html).not.toContain('open=""');expect(html).toContain("Referenced frame");expect(html).toContain("Timeline revision");expect(html).not.toContain("引用画面");
  vi.unstubAllGlobals();
});
