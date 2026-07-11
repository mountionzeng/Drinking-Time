import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  OneClickMaterialLinkStatus,
  OneClickShotPreview,
} from "./OneClickEditAssistant";

describe("OneClickEditAssistant material linkage", () => {
  it("renders the adopted current video when a shot has no still image", () => {
    const html = renderToStaticMarkup(
      <OneClickShotPreview
        title="SH15 当前素材"
        preview={{ kind: "video", url: "/api/videos/take-93.mp4" }}
      />
    );

    expect(html).toContain("<video");
    expect(html).toContain('src="/api/videos/take-93.mp4"');
    expect(html).toContain("当前视频");
    expect(html).toContain("playsInline");
  });

  it("states that adopted and reused videos stay linked while missing shots remain visible", () => {
    const html = renderToStaticMarkup(
      <OneClickMaterialLinkStatus linkedCount={10} totalCount={27} />
    );

    expect(html).toContain("已关联 10 个当前视频");
    expect(html).toContain("采用和复用的镜头会保留");
    expect(html).toContain("待补 17 个");
  });
});
