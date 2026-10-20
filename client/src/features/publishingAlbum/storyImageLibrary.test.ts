import { describe, expect, it } from "vitest";
import type { ImageAsset } from "@shared/imageAsset";
import type { StoryMaterialState } from "@shared/storyMaterial";
import { readStoryLocalImages, storyLibraryImages } from "./storyImageLibrary";

const image = (id: number, patch: Partial<ImageAsset> = {}): ImageAsset => ({
  id, storyId: 7, imageUrl: `/image-${id}.png`, availability: "available",
  ...patch,
} as ImageAsset);
const material = (images: ImageAsset[]): StoryMaterialState => ({
  storyId: 7, warehouseImages: images, unassignedImages: [], shots: [],
} as unknown as StoryMaterialState);

describe("story image library", () => {
  it("keeps old/rejected candidates, deduplicates assets and excludes another story", () => {
    const state = material([
      image(1), image(2, { status: "rejected" }), image(1),
      image(3, { storyId: 8 }),
    ]);
    expect(storyLibraryImages(7, state).map(item => item.id)).toEqual([1, 2]);
    expect(storyLibraryImages(8, state)).toEqual([]);
    expect(storyLibraryImages(7)).toEqual([]);
  });
  it("keeps missing files identifiable instead of presenting them as usable", () => {
    expect(storyLibraryImages(7, material([image(1, { availability: "missing" })]))[0].warning).toBe("原文件缺失");
  });
  it("includes older material projections and related images without requiring a current draft", () => {
    const state = material([]);
    delete state.warehouseImages;
    state.unassignedImages = [image(1)];
    state.shots = [{ imageVersions: [image(2)], relatedImages: [image(1), image(3)] }] as StoryMaterialState["shots"];
    expect(storyLibraryImages(7, state).map(item => item.id)).toEqual([1, 2, 3]);
  });
  it("collects local uploads across versions of the same story without reading another story", () => {
    const picture = (id: number) => ({ id, label: "local.png", imageUrl: "data:image/png;base64,AAAA" });
    const entries = [
      ["publishing-layout-images:7:v1:x", JSON.stringify([picture(-1)])],
      ["publishing-layout-images:7:v2:x", JSON.stringify([picture(-1), picture(-2)])],
      ["publishing-layout-images:70:v1:x", JSON.stringify([picture(-3)])],
      ["publishing-layout-images:7:broken:x", "{broken"],
      ["publishing-layout-images:7:v3:x", JSON.stringify([{ ...picture(-4), imageUrl: "javascript:alert(1)" }])],
    ];
    expect(readStoryLocalImages(7, {
      length: entries.length, key: index => entries[index]?.[0] ?? null,
      getItem: key => entries.find(entry => entry[0] === key)?.[1] ?? null,
    }).map(asset => asset.id)).toEqual([-1, -2]);
  });
});
