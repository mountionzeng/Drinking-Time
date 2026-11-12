import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { UiLanguageContext } from "@/features/uiLanguage/UiLanguage";
const m = vi.hoisted(() => ({ data: [] as any[] }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    storyAgent: {
      chatImageRevisions: {
        useQuery: () => ({ data: m.data, dataUpdatedAt: 1 }),
      },
      attachLuminanceCandidates: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      recoverStoryboardImage: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    useUtils: () => ({}),
  },
}));
import { ChatImageRevisionGallery } from "./ChatImageRevisionGallery";
it("shows the saved object-color decision during rendering without adding controls",()=>{
  vi.stubGlobal("React",React);
  m.data=[{requestId:"palette",shotNo:3,sourceImageId:20,status:"accepted",candidates:[],paletteSummary:"Recolor foliage only; keep paths and airplanes."}];
  const html=renderToStaticMarkup(<UiLanguageContext.Provider value={{language:"en",setLanguage:()=>{}}}><ChatImageRevisionGallery storyId={1}/></UiLanguageContext.Provider>);
  expect(html).toContain("Recolor foliage only; keep paths and airplanes.");
  expect(html).not.toContain("<button");vi.unstubAllGlobals();
});
it("labels wrong-aspect output in English, retains its preview and does not invite replacement", () => {
  vi.stubGlobal("React", React);
  m.data = [{requestId:"wrong-size",shotNo:3,status:"succeeded",sourceImageId:20,candidates:[{
    imageId:21,imageUrl:"/wrong-size.png",dimensionCheck:{status:"mismatch",expected:{width:960,height:960},output:{width:960,height:540}},
  }]}];
  const html = renderToStaticMarkup(<UiLanguageContext.Provider value={{language:"en",setLanguage:()=>{}}}><ChatImageRevisionGallery storyId={1}/></UiLanguageContext.Provider>);
  expect(html).toContain("/wrong-size.png");
  expect(html).toContain("960×540"); expect(html).toContain("960×960");
  expect(html).toContain("Cannot replace");
  expect(html).not.toContain("Reply"); expect(html).not.toContain("尺寸不符");
  vi.unstubAllGlobals();
});
it("shows the image and shot inline and asks for a text decision without more buttons", () => {
  vi.stubGlobal("React", React);
  m.data = [
    {
      requestId: "new",
      shotNo: 1,
      sourceImageId: 20,
      instruction: "brighter",
      status: "succeeded",
      candidates: [{ imageId: 21, imageUrl: "/new.png" }],
    },
  ];
  const html = renderToStaticMarkup(
    <UiLanguageContext.Provider
      value={{ language: "en", setLanguage: () => {} }}
    >
      <ChatImageRevisionGallery storyId={1} />
    </UiLanguageContext.Provider>
  );
  expect(html).toContain('src="/new.png"');
  expect(html).toContain("Shot 01 · Image revision");
  expect(html).toContain("replace original");
  expect(html).toContain('aria-pressed="false"');
  vi.unstubAllGlobals();
});
it("keeps pending work separate from completed previews", () => {
  vi.stubGlobal("React", React);
  m.data = [
    {
      requestId: "pending",
      shotNo: 2,
      sourceImageId: 20,
      status: "accepted",
      candidates: [],
    },
  ];
  const html = renderToStaticMarkup(<ChatImageRevisionGallery storyId={1} />);
  expect(html).toContain("图片正在生成，你可以继续聊天");
  expect(html).not.toContain("是否替换");
  vi.unstubAllGlobals();
});

it("collapses completed previews to the clickable shot context and keeps history out of a focused shot", () => {
  vi.stubGlobal("React", React);
  m.data = [{requestId:"image:old",stableShotId:"s1",shotNo:1,status:"succeeded",candidates:[{imageId:21,imageUrl:"/old"}],decision:{kind:"kept"}}];
  const html = renderToStaticMarkup(<ChatImageRevisionGallery storyId={1} onOpenShot={()=>{}} />);
  expect(html).toContain("对话与素材"); expect(html).not.toContain("max-h-72");
  expect(renderToStaticMarkup(<ChatImageRevisionGallery storyId={1} hidden />)).toBe("");
  vi.unstubAllGlobals();
});

it("shows the original beside actual edited candidates and preserves English UI", () => {
  vi.stubGlobal("React",React);m.data=[{requestId:"refined",shotNo:3,sourceImageId:20,sourceImageUrl:"/original.png",editMode:"retexture",status:"succeeded",candidates:[{imageId:21,imageUrl:"/new.png"}]}];
  const html=renderToStaticMarkup(<UiLanguageContext.Provider value={{language:"en",setLanguage:()=>{}}}><ChatImageRevisionGallery storyId={1}/></UiLanguageContext.Provider>);
  expect(html).toContain('src="/original.png"');expect(html).toContain('src="/new.png"');expect(html).toContain("tonal values");expect(html).not.toContain("原图精修");vi.unstubAllGlobals();
});
it("keeps the focused shot's pending comparison visible while excluding unrelated shot edits",()=>{
 vi.stubGlobal("React",React);m.data=[{requestId:"r3",stableShotId:"s3",shotNo:3,sourceImageId:30,sourceImageUrl:"/original-3",status:"succeeded",candidates:[{imageId:31,imageUrl:"/candidate-3"}]},{requestId:"r1",stableShotId:"s1",shotNo:1,sourceImageId:10,status:"succeeded",candidates:[{imageId:11,imageUrl:"/candidate-1"}]}];
 const html=renderToStaticMarkup(<ChatImageRevisionGallery storyId={1} stableShotId="s3" onOpenShot={()=>{}}/>);
 expect(html).toContain("/original-3");expect(html).toContain("/candidate-3");expect(html).not.toContain("/candidate-1");vi.unstubAllGlobals();
});

it("shows the failure reason without offering adoption or another purchase",()=>{
 vi.stubGlobal("React",React);m.data=[{requestId:"failed",shotNo:3,sourceImageId:20,status:"failed",candidates:[],error:"MJ parameter rejected"}];
 const html=renderToStaticMarkup(<ChatImageRevisionGallery storyId={1}/>);
 expect(html).toContain("MJ parameter rejected");expect(html).not.toContain("是否替换");expect(html).not.toContain("<button");vi.unstubAllGlobals();
});
