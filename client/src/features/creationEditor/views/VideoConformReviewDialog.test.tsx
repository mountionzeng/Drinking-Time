import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  VideoConformReviewPanel,
  type VideoConformReviewItem,
} from "./VideoConformReviewDialog";
import { videoConformReviewKey } from "../videoConformReview";

const reviewItem: VideoConformReviewItem = {
  takeId: 1226,
  stableShotId: "shot-6",
  shotNo: 6,
  title: "人物缓慢转身",
  cameraMove: "镜头缓慢下移，保持人物在画面中央",
  videoUrl: "/api/local-assets/video/take-1226.mp4",
  posterUrl: "/api/local-assets/image/shot-6.png",
  sourceAspectRatio: "9:16",
  aiExpandUnavailableReason: null,
  recommendation: {
    mode: "ai_expand",
    confidence: "high",
    cropAxis: "vertical",
    reason: "运镜会经过上下裁切边缘，建议外扩。",
  },
};

describe("VideoConformReviewPanel", () => {
  it("shows the real camera move and requires an explicit per-shot choice", () => {
    const html = renderToStaticMarkup(
      <VideoConformReviewPanel
        items={[reviewItem]}
        targetAspectRatio="1:1"
        aiExpandReady={false}
        decisions={new Map()}
        cropPaths={new Map()}
        submitting={false}
        onDecisionChange={vi.fn()}
        onCropPathChange={vi.fn()}
        onApplyRecommendations={vi.fn()}
        onAllCrop={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(html).toContain("镜头缓慢下移，保持人物在画面中央");
    expect(html).toContain("take-1226.mp4");
    expect(html).toContain("直接裁切");
    expect(html).toContain("302 专业视频外扩");
    expect(html).toContain("缺少 API302_KEY");
    expect(html).toContain("还有 1 个镜头待确认");
  });

  it("summarizes a confirmed paid expansion before execution", () => {
    const html = renderToStaticMarkup(
      <VideoConformReviewPanel
        items={[reviewItem]}
        targetAspectRatio="1:1"
        aiExpandReady
        decisions={new Map([[videoConformReviewKey(reviewItem), "ai_expand"]])}
        cropPaths={new Map()}
        submitting={false}
        onDecisionChange={vi.fn()}
        onCropPathChange={vi.fn()}
        onApplyRecommendations={vi.fn()}
        onAllCrop={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(html).toContain("执行 1 个视频（含 1 个 302）");
    expect(html).toContain("提交时可能消耗额度");
  });

  it("shows a per-shot crop path from the middle first frame to the bottom final frame", () => {
    const key = videoConformReviewKey(reviewItem);
    const html = renderToStaticMarkup(
      <VideoConformReviewPanel
        items={[reviewItem]}
        targetAspectRatio="1:1"
        aiExpandReady
        decisions={new Map([[key, "crop"]])}
        cropPaths={
          new Map([[key, { start: "center" as const, end: "end" as const }]])
        }
        submitting={false}
        onDecisionChange={vi.fn()}
        onCropPathChange={vi.fn()}
        onApplyRecommendations={vi.fn()}
        onAllCrop={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(html).toContain("裁剪路径");
    expect(html).toContain("第一帧");
    expect(html).toContain("最后一帧");
    expect(html).toContain("中间 → 底部");
    expect(html).toContain('aria-label="SH06 最后一帧 底部"');
    expect(html).toContain('aria-pressed="true"');
  });
});
