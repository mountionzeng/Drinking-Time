import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FinishedProductVersion } from "@shared/finishedProductVersion";
import { PublishingVersionControls } from "./PublishingVersionControls";

vi.stubGlobal("React", React);

const row = (status: "editing" | "completed"): FinishedProductVersion => ({
  id: "finished-1",
  sequence: 1,
  status,
  purpose: "缩短开场、提高观看留存",
  textVersionId: "v4",
  images: [{ stableShotId: "shot-a", imageId: 11 }],
  videos: [],
  imageVersion: status === "completed" ? 2 : null,
  videoVersion: null,
  createdAt: 1,
  updatedAt: 1,
  completedAt: status === "completed" ? 1 : null,
});

describe("PublishingVersionControls", () => {
  it("shows one compact composition table without rename, switch, or version wizard controls", () => {
    const html = renderToStaticMarkup(
      <PublishingVersionControls
        versions={[row("completed"), { ...row("editing"), id: "finished-2", sequence: 2 }]}
        purpose="统一视觉"
        busy={false}
        canSaveText
        canSaveImage
        canSaveVideo
        onPurposeChange={vi.fn()}
        onSaveText={vi.fn()}
        onSaveImage={vi.fn()}
        onSaveVideo={vi.fn()}
        onComplete={vi.fn()}
        onAbandon={vi.fn()}
      />
    );

    expect(html).toContain("成品版本");
    expect(html).toContain("Text V4");
    expect(html).toContain("Image V2");
    expect(html).toContain("Image 新");
    expect(html).toContain("修改目的");
    expect(html).toContain("完成版本");
    expect(html).toContain("保存图像新版");
    expect(html).toContain("保存视频新版");
    expect(html).not.toContain("重命名");
    expect(html).not.toContain("选择发布版本");
    expect(html).not.toContain("待更新");
  });
});
