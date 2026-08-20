import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ExtractedFrameTransitionRequirementsDialog from "./ExtractedFrameTransitionRequirementsDialog";

vi.stubGlobal("React", React);

describe("ExtractedFrameTransitionRequirementsDialog", () => {
  it("shows both endpoints, the capped duration, motion input, and amplitude choices", () => {
    const html = renderToStaticMarkup(
      <ExtractedFrameTransitionRequirementsDialog
        left={{ id: "a", imageId: 1, atMs: 1_000, imageUrl: "/a.webp" }}
        right={{ id: "b", imageId: 2, atMs: 13_000, imageUrl: "/b.webp" }}
        onCancel={vi.fn()}
        onContinue={vi.fn(async () => ({ applied: true }))}
      />
    );
    expect(html).toContain("图片 #1");
    expect(html).toContain("图片 #2");
    expect(html).toContain("实际请求：8 秒");
    expect(html).toContain("描述相机如何运动");
    expect(html).toContain('value="medium"');
    expect(html).toContain("继续，生成待确认卡");
  });
});
