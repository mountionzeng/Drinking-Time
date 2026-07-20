import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StoryboardMediaPreviewDialog } from "./StoryboardMediaPreview";

describe("StoryboardMediaPreviewDialog", () => {
  it("renders a playable video preview with its poster", () => {
    const markup = renderToStaticMarkup(
      createElement(StoryboardMediaPreviewDialog, {
        preview: {
          kind: "video",
          url: "/api/videos/take-22.mp4",
          poster: "/api/video-frames/22?atSec=0.000",
          label: "0102 当前画面",
        },
        onClose: vi.fn(),
      })
    );

    expect(markup).toContain("<video");
    expect(markup).toContain('src="/api/videos/take-22.mp4"');
    expect(markup).toContain('poster="/api/video-frames/22?atSec=0.000"');
    expect(markup).toContain("关闭预览");
  });

  it("renders an image preview without video controls", () => {
    const markup = renderToStaticMarkup(
      createElement(StoryboardMediaPreviewDialog, {
        preview: {
          kind: "image",
          url: "/api/images/current-shot.webp",
          label: "0102 当前画面",
        },
        onClose: vi.fn(),
      })
    );

    expect(markup).toContain("<img");
    expect(markup).toContain('src="/api/images/current-shot.webp"');
    expect(markup).not.toContain("<video");
  });
});
