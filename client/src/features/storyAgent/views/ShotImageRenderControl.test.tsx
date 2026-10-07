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
    expect(html).toContain("MJ · 约 ¥0.68");
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
