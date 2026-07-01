import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CreationEditorShot } from "../CreationEditorContext";
import type { VideoTakeAsset } from "@shared/videoAsset";
import AnimaticPlayer from "./AnimaticPlayer";

function videoTake(overrides: Partial<VideoTakeAsset> = {}) {
  return {
    id: 12,
    storyId: 36,
    userId: 48,
    stableShotId: "shot-001",
    sourceImageId: 270,
    promptCompilationId: null,
    promptFreshness: "current",
    status: "available",
    taskId: "task-12",
    provider: "302",
    model: "mj-video",
    prompt: "slow push in",
    subtitle: null,
    durationSec: 5,
    aspectRatio: "16:9",
    videoKey: null,
    videoUrl: "/api/videos/take-12.mp4",
    errorMessage: null,
    parameterSnapshot: null,
    extractionCapability: "available",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ranges: [],
    selectedRangeId: null,
    selectedSelectionType: "full_take",
    isTimelineSelected: true,
    ...overrides,
  } satisfies VideoTakeAsset;
}

describe("AnimaticPlayer selection actions", () => {
  it("surfaces image/video region and video time-range actions for Xiaozhuo", () => {
    const shot = {
      shotNo: 1,
      shotKey: "SH01",
      stableShotId: "shot-001",
      subject: "人物在窗边停顿",
      action: "慢慢回头",
      dialogue: "这句话很有意思",
      imageId: 270,
      imageUrl: "/api/images/current-frame.png",
      imageSelectionSource: "explicit",
      videoTakes: [videoTake()],
    } as CreationEditorShot;

    const html = renderToStaticMarkup(
      <AnimaticPlayer
        storyId={36}
        shots={[shot]}
        selectedShotNo={1}
        onShotEnter={vi.fn()}
        isPlaying={false}
        onPlayingChange={vi.fn()}
        onSelectContext={vi.fn()}
        onCreateVideoTakeRange={vi.fn()}
        onSelectVideoTimelineSegment={vi.fn()}
      />
    );

    expect(html).toContain("框选问小酌");
    expect(html).toContain("拖动入点/出点框选一段");
    expect(html).toContain("发送给小酌");
  });
});
