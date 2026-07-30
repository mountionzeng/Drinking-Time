import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TIMELINE_TRANSFORM,
  DEFAULT_TIMELINE_VIDEO_EFFECTS,
} from "@shared/storyMaterial";
import VideoClipEditorPanel from "./VideoClipEditorPanel";

describe("VideoClipEditorPanel", () => {
  it("renders timing, playback, audio, and complete visual transform controls", () => {
    const markup = renderToStaticMarkup(
      createElement(VideoClipEditorPanel, {
        target: {
          stableShotId: "shot-0102",
          shotNo: 2,
          cueCode: "0102",
          takeId: 1289,
          rangeId: null,
          clipId: null,
          videoUrl: "/video.mp4",
          posterUrl: "/poster.webp",
          label: "0102 · Take 1289",
          mediaDurationSec: 6.77,
          sourceStartSec: 0,
          sourceEndSec: 4.733,
          effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS },
          transform: { ...DEFAULT_TIMELINE_TRANSFORM },
          isTimelineSelected: true,
        },
        saving: false,
        onClose: () => undefined,
        onApply: async () => undefined,
        onPreviewChange: () => undefined,
      })
    );

    expect(markup).toContain('data-testid="video-clip-editor"');
    expect(markup).toContain(
      'data-preview-target="editing-preview-stage"'
    );
    expect(markup).toContain("实时预览");
    expect(markup).not.toContain("<video");
    expect(markup).toContain("裁切");
    expect(markup).toContain("速度与方向");
    expect(markup).toContain("原声");
    expect(markup).toContain("旋转与翻转");
    expect(markup).toContain('aria-label="水平翻转"');
    expect(markup).toContain('aria-label="垂直翻转"');
    expect(markup).toContain("应用到时间线");
  });
});
