import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SelectionContextCard from "./SelectionContextCard";

describe("SelectionContextCard", () => {
  it("labels the exact timeline frame selected for chat", () => {
    const html = renderToStaticMarkup(
      <SelectionContextCard
        selection={{
          sourceType: "storyboard-image",
          sourceId: "timeline-frame:frame-88",
          selectedText: "0101 · 当前帧 00:01.433 · 当前抽帧",
          objectVersion: "timeline-clip:frame-88",
          stableShotId: "shot-0101",
          shotNo: 1,
          cueCode: "0101",
        }}
      />
    );

    expect(html).toContain("当前抽帧");
    expect(html).toContain("timeline-clip:frame-88");
    expect(html).not.toContain("故事版主图");
  });
});
