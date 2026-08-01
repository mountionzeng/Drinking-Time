import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CreationEditorShot } from "../types";
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

function buttonHtmlAround(html: string, label: string) {
  const labelIndex = html.indexOf(label);
  expect(labelIndex).toBeGreaterThanOrEqual(0);
  const start = html.lastIndexOf("<button", labelIndex);
  const end = html.indexOf("</button>", labelIndex);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
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
    } as unknown as CreationEditorShot;

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

  it("keeps the image region entry enabled for legacy URL-only current frames", () => {
    const shot = {
      shotNo: 1,
      shotKey: "SH01",
      stableShotId: "shot-001",
      subject: "人物在窗边停顿",
      action: "慢慢回头",
      dialogue: "这句话很有意思",
      promptRun: {
        finalPrompt: "人物在窗边停顿",
        generatedAt: Date.now(),
        imageUrl: "/api/images/legacy-frame.png",
        source: "prompt-table-rerender",
        usedDimensions: ["subject", "action"],
      },
      imageSelectionSource: "legacy",
      videoTakes: [],
    } as unknown as CreationEditorShot;

    const html = renderToStaticMarkup(
      <AnimaticPlayer
        storyId={36}
        shots={[shot]}
        selectedShotNo={1}
        onShotEnter={vi.fn()}
        isPlaying={false}
        onPlayingChange={vi.fn()}
        onSelectContext={vi.fn()}
      />
    );

    expect(buttonHtmlAround(html, "框选问小酌")).not.toMatch(
      /\sdisabled(=|\s|>)/
    );
  });

  it("keeps failed, unadopted takes out of the animatic editing surface", () => {
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
      videoTakes: [
        videoTake({
          id: 17,
          status: "failed",
          videoUrl: null,
          errorMessage: "Prompt parameter error or image not approved",
          isTimelineSelected: false,
        }),
      ],
    } as unknown as CreationEditorShot;

    const html = renderToStaticMarkup(
      <AnimaticPlayer
        storyId={36}
        shots={[shot]}
        selectedShotNo={1}
        onShotEnter={vi.fn()}
        isPlaying={false}
        onPlayingChange={vi.fn()}
        onSelectContext={vi.fn()}
      />
    );

    expect(html).not.toContain("视频预览和采用在故事版看板完成");
    expect(html).not.toContain("这一镜：");
    expect(html).not.toContain("运动/声音：");
    expect(html).not.toContain("还没有已采用视频");
    expect(html).not.toContain("Take 17");
    expect(html).not.toContain("MJ 未通过提示词或首帧审核");
    expect(html).not.toContain("当前 Take 17");
    expect(html).not.toContain("当前视频：failed");
  });

  it("plays the whole film with text fallback when a shot has no media", () => {
    const shot = {
      shotNo: 2,
      shotKey: "SH02",
      stableShotId: "shot-002",
      intent: "建立世界规则",
      subject: "猫作为主角的日常空间",
      action: "穿过安静的房间",
      dialogue: "",
      rationale: "让观众理解这个世界的气质",
      videoTakes: [],
    } as unknown as CreationEditorShot;

    const html = renderToStaticMarkup(
      <AnimaticPlayer
        storyId={36}
        shots={[shot]}
        selectedShotNo={2}
        onShotEnter={vi.fn()}
        isPlaying={false}
        onPlayingChange={vi.fn()}
        onSelectContext={vi.fn()}
      />
    );

    expect(html).toContain('aria-label="播放全片"');
    expect(html).toContain("暂无画面素材，播放时先以文字镜头占位。");
    expect(html).toContain("建立世界规则");
    expect(html).toContain("猫作为主角的日常空间");
    expect(html).not.toContain("动态分镜待出图");
  });

  it("shows the progress rail against the full film duration", () => {
    const shots = [
      {
        shotNo: 1,
        shotKey: "SH01",
        stableShotId: "shot-001",
        dialogue: "第一镜",
        videoTakes: [],
      },
      {
        shotNo: 2,
        shotKey: "SH02",
        stableShotId: "shot-002",
        dialogue: "第二镜",
        videoTakes: [],
      },
    ] as unknown as CreationEditorShot[];

    const html = renderToStaticMarkup(
      <AnimaticPlayer
        storyId={36}
        shots={shots}
        selectedShotNo={1}
        durationsByShotNo={{ 1: 2000, 2: 3000 }}
        onShotEnter={vi.fn()}
        isPlaying={false}
        onPlayingChange={vi.fn()}
        onSelectContext={vi.fn()}
        onDurationChange={vi.fn()}
      />
    );

    expect(html).toContain("01 · 0.0s / 5.0s");
    expect(html).toContain('aria-label="调整01时长"');
    expect(html).toContain("时长 2.0s");
  });

  it("keeps full-film progress visible while previewing a single shot", () => {
    const fullFilmShots = [
      {
        shotNo: 1,
        shotKey: "SH01",
        stableShotId: "shot-001",
        dialogue: "第一镜",
        videoTakes: [],
      },
      {
        shotNo: 2,
        shotKey: "SH02",
        stableShotId: "shot-002",
        dialogue: "第二镜",
        videoTakes: [],
      },
    ] as unknown as CreationEditorShot[];

    const html = renderToStaticMarkup(
      <AnimaticPlayer
        storyId={36}
        shots={[fullFilmShots[1]]}
        progressShots={fullFilmShots}
        selectedShotNo={2}
        durationsByShotNo={{ 1: 2000, 2: 3000 }}
        onShotEnter={vi.fn()}
        isPlaying={false}
        onPlayingChange={vi.fn()}
        onSelectContext={vi.fn()}
      />
    );

    expect(html).toContain("02 · 2.0s / 5.0s");
  });
});
