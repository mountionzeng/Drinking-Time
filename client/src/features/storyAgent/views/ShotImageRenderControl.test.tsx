import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ShotImageRenderControl,
  changeRenderReference,
  loadShotRenderSettings,
  selectedReferenceKeys,
  shotRenderReferenceOptions,
} from "./ShotImageRenderControl";
import type { StoryMaterialState } from "@shared/storyMaterial";
beforeEach(() => vi.stubGlobal("React", React));
describe("shot render control", () => {
  it("uses a confirmed art-system baseline unless the user has an explicit override", () => {
    const getItem = vi.fn().mockReturnValue(null); vi.stubGlobal("localStorage", { getItem });
    const image = { id: 88, imageUrl: "/baseline.png" };
    const material = { artSystemReference: { version: 2, name: "Watercolor", image }, shots: [{ stableShotId: "s2", imageVersions: [] }], unassignedImages: [] } as unknown as StoryMaterialState;
    expect(loadShotRenderSettings(1, "s2", material).references).toEqual({ imageIds: [88], imagePurpose: "scene-style", assets: {} });
    expect(shotRenderReferenceOptions(material).map(ref => ref.imageId)).toContain(88);
    getItem.mockReturnValue(JSON.stringify({ count: 4, references: { imageIds: [], assets: {} } }));
    expect(loadShotRenderSettings(1, "s2", material).references.imageIds).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("recognizes a manually reselected established image as continuity, preserving composition freedom", () => {
    const reference = { key: "image:19", label: "图片 #19", imageId: 19, imageUrl: "/confirmed.png" };
    const selected = changeRenderReference({ imageIds: [], assets: {} }, reference, false, [19]);
    expect(selected).toEqual({ imageIds: [19], imagePurpose: "scene-style", assets: {} });
    expect(changeRenderReference(selected, reference, true, [19])).toEqual({ imageIds: [], assets: {} });
  });
  it("inherits the established earlier image, never an unchosen candidate, and preserves an empty override", () => {
    const getItem = vi.fn().mockReturnValue(null);
    vi.stubGlobal("localStorage", { getItem });
    const material = { shots: [
      { stableShotId: "first", currentImage: { id: 19, imageUrl: "/confirmed.png" } },
      { stableShotId: "unselected", currentImage: null, imageVersions: [{ id: 22, imageUrl: "/wrong.png" }] },
      { stableShotId: "target", currentImage: null },
    ] } as unknown as StoryMaterialState;
    expect(loadShotRenderSettings(1, "target", material).references).toEqual({ imageIds: [19], imagePurpose: "scene-style", assets: {} });
    material.shots[0].currentImage = { id: 20, imageUrl: "/second-selected.png" } as typeof material.shots[0]["currentImage"];
    expect(loadShotRenderSettings(1, "target", material).references.imageIds).toEqual([20]);
    material.shots[0].currentImage = { id: 19, imageUrl: "/confirmed.png" } as typeof material.shots[0]["currentImage"];
    material.shots[0].imageVersions = [{ id: 20, imageUrl: "/second-selected.png", isPrimary: true, selectionSource: "explicit" }] as typeof material.shots[0]["imageVersions"];
    expect(loadShotRenderSettings(1, "target", material).references.imageIds).toEqual([20]);
    material.shots[0].imageVersions = [];
    material.shots[0].imageGenerationReferences = [material.shots[0].currentImage!];
    material.shots[0].currentImage = null;
    expect(loadShotRenderSettings(1, "target", material).references.imageIds).toEqual([19]);
    getItem.mockReturnValue(JSON.stringify({ count: 4, references: { imageIds: [], assets: {} } }));
    expect(loadShotRenderSettings(1, "target", material).references.imageIds).toEqual([]);
    vi.unstubAllGlobals();
  });
  it("prefills every book-act reference, while an explicit saved empty selection stays empty", () => {
    const material = { shots: [{ stableShotId: "act-1", imageGenerationReferences: [{id: 1}, {id: 2}] }] } as unknown as StoryMaterialState;
    expect(loadShotRenderSettings(1, "act-1", material).references.imageIds).toEqual([1, 2]);
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({count: 4, references: {imageIds: [], assets: {}}}) });
    expect(loadShotRenderSettings(1, "act-1", material).references.imageIds).toEqual([]);
    vi.unstubAllGlobals();
  });
  it("prefills the supplemental illustration reference but preserves an explicit user removal", () => {
    const image = { id: 88, imageUrl: "/illustration.png" };
    const material = { shots: [{ stableShotId: "detail", imageVersions: [], imageGenerationReference: image }], unassignedImages: [] } as unknown as StoryMaterialState;
    const getItem = vi.fn().mockReturnValue(null);
    vi.stubGlobal("localStorage", { getItem });
    expect(loadShotRenderSettings(1, "detail", material).references).toEqual({ imageIds: [88], assets: {} });
    expect(shotRenderReferenceOptions(material)).toContainEqual({ key: "image:88", label: "图片 #88", imageId: 88, imageUrl: image.imageUrl });
    getItem.mockReturnValue(JSON.stringify({ count: 1, references: { imageIds: [], assets: {} } }));
    expect(loadShotRenderSettings(1, "detail", material).references.imageIds).toEqual([]);
    vi.unstubAllGlobals();
  });
  it("renders one fixed four-image action without a count input or duplicate explanation", () => {
    const html = renderToStaticMarkup(
      <ShotImageRenderControl
        storyId={1}
        stableShotId="s"
        label="02"
        disabled={false}
        busy={false}
        onRender={async () => {}}
      />
    );
    expect(html).not.toContain('type="number"');
    expect(html).toContain('aria-label="02 生成4张图"');
    expect(html).toContain("生成4张图");
    expect(html).not.toContain("参考素材出 1 张");
    expect(html).toContain("MJ · 约 1.36 算力");
    expect(html).not.toContain("MJ 每次 4 张");
  });
  it("removal creates an explicit empty list and replacement keeps one pet", () => {
    const pet = {
      key: "asset:v1",
      label: "猫",
      imageUrl: "cat.png",
      kind: "pet" as const,
      assetId: "a",
      versionId: "v1",
    };
    const selected = changeRenderReference(
      { imageIds: [], assets: {} },
      pet,
      false
    );
    expect(changeRenderReference({ imageIds: [19], imagePurpose: "scene-style", assets: {} }, pet, false))
      .toEqual({ imageIds: [19], assets: { pet: { assetId: "a", versionId: "v1" } } });
    expect(selectedReferenceKeys(selected)).toEqual(["asset:v1"]);
    expect(changeRenderReference(selected, pet, true)).toEqual({
      imageIds: [],
      assets: {},
    });
    expect(
      selectedReferenceKeys(
        changeRenderReference(
          selected,
          { ...pet, key: "asset:v2", versionId: "v2" },
          false
        )
      )
    ).toEqual(["asset:v2"]);
  });
  it("reload retains empty references but normalizes the legacy eight-image choice to four", () => {
    const getItem = vi
      .fn()
      .mockReturnValue(
        JSON.stringify({ count: 8, references: { imageIds: [], assets: {} } })
      );
    vi.stubGlobal("localStorage", { getItem });
    expect(loadShotRenderSettings(1196, "shot02")).toEqual({
      count: 4,
      references: { imageIds: [], assets: {} },
    });
    expect(getItem).toHaveBeenCalledWith("shot-image-render:1196:shot02");
    vi.unstubAllGlobals();
  });
});
