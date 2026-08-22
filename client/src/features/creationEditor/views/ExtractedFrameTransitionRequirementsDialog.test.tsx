import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ExtractedFrameTransitionRequirementsDialog from "./ExtractedFrameTransitionRequirementsDialog";

vi.stubGlobal("React", React);

describe("ExtractedFrameTransitionRequirementsDialog", () => {
  it("asks for a complete video description while keeping endpoints and amplitude visible", () => {
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
    expect(html).toContain("描述这段视频要发生什么");
    expect(html).toContain("完整画面描述");
    expect(html).toContain("场景快速变暗，镜头推向女主的眼睛");
    expect(html).toContain('maxLength="2000"');
    expect(html).toContain("整体运动幅度（可选）");
    expect(html).toContain('value="medium"');
    expect(html).toContain("继续，生成待确认卡");
  });
});
