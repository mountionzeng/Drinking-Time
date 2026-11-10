import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { UiLanguageContext } from "@/features/uiLanguage/UiLanguage";
const m = vi.hoisted(() => ({ data: [] as any[] }));
vi.mock("@/lib/trpc", () => ({ trpc: { artSystems: { previewRead: { useQuery: () => ({ data: m.data, dataUpdatedAt: 1 }) } }, storyAgent: { recoverStoryboardImage: { useMutation: () => ({ mutateAsync: vi.fn() }) } }, useUtils: () => ({}) } }));
import { ArtPreviewGallery } from "./ArtPreviewGallery";
it("groups candidate ordinals by shot, keeps versions, and needs no action buttons", () => {
  vi.stubGlobal("React", React);
  m.data = [{ id: "batch", version: 2, createdAt: 1000, editorName: "Author", instruction: "new idea", baselineImageId: 2038,
    shots: [1,2].map(n => ({ stableShotId: `s${n}`, label: `0${n}`, adaptation: `changes ${n}`, status: "succeeded", candidates: [1,2,3,4].map(i => ({ imageId: n * 10 + i, imageUrl: `/s${n}-${i}.png` })) })) }];
  const html = renderToStaticMarkup(<UiLanguageContext.Provider value={{ language: "en", setLanguage: () => {} }}><ArtPreviewGallery storyId={1} /></UiLanguageContext.Provider>);
  expect(html).toContain("Shot previews"); expect(html).toContain("Preview version");
  expect(html).toContain("Shot 02 · Image 3"); expect(html).toContain("V2"); expect(html).toContain("Author");
  expect(html.match(/<img/g)).toHaveLength(8); expect(html).not.toContain("<button");
  vi.unstubAllGlobals();
});
