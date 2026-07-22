import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DEFAULT_TIMELINE_TRANSFORM } from "@shared/storyMaterial";
import ImageClipEditorPanel from "./ImageClipEditorPanel";

describe("ImageClipEditorPanel", () => {
  it("renders the image composition controls used by the storyboard workflow", () => {
    const markup = renderToStaticMarkup(
      createElement(ImageClipEditorPanel, {
        target: {
          stableShotId: "shot-0101",
          shotNo: 1,
          cueCode: "0101",
          imageId: 42,
          imageUrl: "/image.png",
          label: "0101 · 首帧",
          transform: { ...DEFAULT_TIMELINE_TRANSFORM },
        },
        saving: false,
        onClose: () => undefined,
        onApply: async () => undefined,
      })
    );

    expect(markup).toContain('data-testid="image-clip-editor"');
    expect(markup).toContain("缩放");
    expect(markup).toContain("水平位置");
    expect(markup).toContain("垂直位置");
    expect(markup).toContain("旋转与翻转");
    expect(markup).toContain('aria-label="水平翻转"');
    expect(markup).toContain("应用到镜头");
  });
});
