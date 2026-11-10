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
      recoverStoryboardImage: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    useUtils: () => ({}),
  },
}));
import { ChatImageRevisionGallery } from "./ChatImageRevisionGallery";
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
