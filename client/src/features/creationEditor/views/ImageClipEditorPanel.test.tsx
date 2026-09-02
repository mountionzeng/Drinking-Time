import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_TIMELINE_TRANSFORM } from "@shared/storyMaterial";
import ImageClipEditorPanel from "./ImageClipEditorPanel";

vi.stubGlobal("React", React);

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
          textOverlay: null,
          defaultText: "默认旁白内容",
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
    expect(markup).toContain("倒转 180°");
    expect(markup).toContain("添加文字");
    expect(markup).toContain("提取文字");
    expect(markup).toContain('aria-label="水平翻转"');
    expect(markup).toContain("应用到这张图");
  });

  it("opens directly on the saved text layer for this exact image", () => {
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
          defaultText: "不应覆盖已保存文字的旁白",
          textOverlay: {
            text: "午饭刚吃到一半",
            typography: {
              layoutVersion: 1,
              fontId: "noto-serif-sc",
              alignment: "center",
              fontSize: 48,
              letterSpacing: 0,
              lineSpacing: 1.3,
              contrast: {
                textColor: "#ffffff",
                outlineColor: "#000000",
                outlineWidth: 1.5,
                backdropColor: null,
              },
              kind: "region",
              shape: "rectangle",
              direction: "horizontal",
              region: { x: 0.1, y: 0.7, width: 0.8, height: 0.2 },
            },
          },
        },
        saving: false,
        onClose: () => undefined,
        onApply: async () => undefined,
      })
    );

    expect(markup).toContain("文字内容");
    expect(markup).toContain("午饭刚吃到一半");
    expect(markup).toContain("完成排版");
    expect(markup).toContain("字号");
    expect(markup).toContain("字间距");
    expect(markup).toContain("应用到这张图");
  });
});
