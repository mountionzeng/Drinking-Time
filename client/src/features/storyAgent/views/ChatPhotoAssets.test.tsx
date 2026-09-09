import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StoryMaterialState } from "@shared/storyMaterial";
import ChatPhotoAssets from "./ChatPhotoAssets";

vi.stubGlobal("React", React);
vi.mock("@/features/creationEditor/visualAssets/VisualAssetLibrary", () => ({
  default: (props: { storyId: number; images: { id: number }[]; initialInstruction: string; initialIncludeTopView: boolean }) =>
    <div data-testid="reused-library" data-story={props.storyId} data-top={props.initialIncludeTopView}>
      {props.images.map(image => image.id).join(",")}{props.initialInstruction}
    </div>,
}));

describe("ChatPhotoAssets", () => {
  it("opens the existing story library with the requested art and top view without starting generation", () => {
    const markup = renderToStaticMarkup(<ChatPhotoAssets storyId={7} materialState={null}
      request={{ storyId: 7, instruction: "朦胧彩铅，正面侧面顶部", notice: "照片已入库" }} />);
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('data-top="true"');
    expect(markup).toContain("朦胧彩铅");
    expect(markup).toContain("照片已入库");
    expect(markup).toContain("不是真实外观证据");
    expect(markup).toContain("确认费用");
  });
  it("keeps the affordance after refresh and does not mount the library until opened", () => {
    const markup = renderToStaticMarkup(<ChatPhotoAssets storyId={7} materialState={null} request={null} />);
    expect(markup).toContain("照片 → 艺术素材");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('data-testid="reused-library"');
  });
  it("never projects cached material images from a different story", () => {
    const foreign = { storyId: 8, unassignedImages: [{ id: 981, imageUrl: "foreign.jpg" }], shots: [] } as unknown as StoryMaterialState;
    const markup = renderToStaticMarkup(<ChatPhotoAssets storyId={7} materialState={foreign}
      request={{ storyId: 7, instruction: "素材", notice: "" }} />);
    expect(markup).not.toContain("981");
  });
});
