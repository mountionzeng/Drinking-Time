import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ShotImageRenderControl,
  changeRenderReference,
  loadShotRenderSettings,
  selectedReferenceKeys,
} from "./ShotImageRenderControl";
vi.stubGlobal("React", React);
describe("shot render control", () => {
  it("renders one editable count and one render action", () => {
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
    expect(html).toContain('aria-label="02 渲染张数"');
    expect(html).toContain('value="1"');
    expect(html).toContain('aria-label="渲染 02 的 1 张图片"');
    expect(html).not.toContain("参考素材出 1 张");
    expect(html).toContain("MJ · 约 ¥0.68");
    expect(html).toContain("MJ 每次 4 张");
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
  it("reload retains empty references and edited count", () => {
    const getItem = vi
      .fn()
      .mockReturnValue(
        JSON.stringify({ count: 4, references: { imageIds: [], assets: {} } })
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
