import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CreationEditorShot } from "../CreationEditorContext";
import ShotFrameCandidatePicker from "./ShotFrameCandidatePicker";

describe("ShotFrameCandidatePicker", () => {
  it("renders the four quadrants as separate, inspectable candidate images", () => {
    const shot = {
      shotNo: 1,
      shotKey: "SH01",
      promptRun: {
        finalPrompt: "four-up candidate sheet",
        generatedAt: 1,
        imageId: 36,
        imageUrl: "/api/images/story-36-sh01.png",
        source: "prompt-table-rerender",
        usedDimensions: ["subject"],
      },
    } as CreationEditorShot;

    const html = renderToStaticMarkup(
      <ShotFrameCandidatePicker shot={shot} onPromote={vi.fn()} />
    );

    expect(html.match(/data-frame-candidate=/g)).toHaveLength(4);
    expect(html).toContain("放大比较");
    expect(html).toContain("选择左上作为当前主图");
    expect(html).toContain("选择右下作为当前主图");
  });
});
