import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import ShotPreview from "./ShotPreview";

vi.stubGlobal("React", React);

vi.mock("@/lib/trpc", () => {
  const query = () => ({ data: undefined });
  const mutation = () => ({ isPending: false, mutateAsync: vi.fn() });
  return {
    trpc: {
      creationAgent: {
        maskSelectionCapabilities: { useQuery: query },
        segmentRegion: { useMutation: mutation },
        quoteInpaint: { useMutation: mutation },
        inpaint: { useMutation: mutation },
        adoptInpaintCandidate: { useMutation: mutation },
        latestInpaintCandidate: { useQuery: query },
      },
    },
  };
});

vi.mock("@/features/storyAgent/StoryAgentContext", () => ({
  useStoryAgentActions: () => ({
    registerImageRegionEditRunner: () => () => undefined,
    setActiveSelection: vi.fn(),
  }),
}));

const source = readFileSync(
  resolve(
    process.cwd(),
    "client/src/features/creationEditor/views/ShotPreview.tsx"
  ),
  "utf8"
);
const workspaceSource = readFileSync(
  resolve(
    process.cwd(),
    "client/src/features/creationEditor/views/EditingNleWorkspace.tsx"
  ),
  "utf8"
);

describe("Preview object mask editor integration", () => {
  it("extracts a frame from one Preview action, then puts adjustment actions below it", () => {
    expect(source).toContain("调整画面");
    expect(source).toContain("当前抽帧已就绪");
    expect(source).toContain('data-testid="preview-frame-tools"');
    expect(source).toContain("构图与文字");
    expect(source).toContain("圈选局部");
    expect(source).toContain("在聊天框修改");
    expect(source).not.toContain('data-testid="preview-frame-edit-menu"');
    expect(source).not.toContain("ChevronDown");
  });

  it("renders the extracted frame and its editing actions over the paused video", () => {
    const transform = {
      cropX: 0,
      cropY: 0,
      cropWidth: 1,
      cropHeight: 1,
      zoom: 1,
      panX: 0,
      panY: 0,
      rotationDeg: 0,
      flipX: false,
      flipY: false,
    };
    const html = renderToStaticMarkup(
      <ShotPreview
        shot={null}
        timelineVideoSource={{
          shotNo: 1,
          stableShotId: "shot-1",
          takeStableShotId: "shot-1",
          takeId: 5,
          rangeId: null,
          videoUrl: "/source.mp4",
          sourceStartSec: 0,
          sourceEndSec: 10,
          sourceTimeSec: 1.033,
          offsetMs: 0,
          durationMs: 10_000,
          existingClipId: null,
          label: "源视频",
          effects: { playbackRate: 1, reverse: false, volume: 1, muted: false },
          transform,
          visualLayer: 0,
        }}
        timelineImageSource={{ imageUrl: "/frame-17.png", transform }}
        maskEditTarget={{
          targetKind: "timeline-image-clip",
          clipId: "frame-17",
          stableShotId: "shot-1",
          shotNo: 1,
          imageId: 17,
          imageUrl: "/frame-17.png",
          label: "当前帧",
          transform,
          textOverlay: null,
          defaultText: "",
        }}
        playheadMs={1_033}
        timelinePlaying={false}
        format={null}
        onRequestTimelinePlaying={vi.fn()}
        keyboardShortcutZoneRef={{ current: false }}
        onEditImage={vi.fn()}
        onSelectImageForChat={vi.fn()}
        onEditCurrentVideoFrame={vi.fn()}
      />
    );

    expect(html).toContain('src="/source.mp4"');
    expect(html).toContain('src="/frame-17.png"');
    expect(html).toContain('data-testid="editing-preview-frame-overlay"');
    expect(html).toContain("当前抽帧已就绪");
    expect(html).toContain("构图与文字");
    expect(html).toContain("圈选局部");
    expect(html).toContain("在聊天框修改");
  });

  it("moves the one Preview clock only for an explicit shot selection", () => {
    expect(workspaceSource).toContain("selectedShotPlayheadSyncTarget");
    expect(workspaceSource).toMatch(
      /selectionFromPlayheadRef\.current[\s\S]*?playbackClock\.seek\(syncTargetMs\)/
    );
  });

  it("surfaces frame extraction failures instead of silently returning to idle", () => {
    expect(workspaceSource).toMatch(
      /editCurrentVideoFrame[\s\S]*?catch \(error\) \{[\s\S]*?toast\.error\(error instanceof Error \? error\.message : "当前帧编辑失败"\)/
    );
  });

  it("shows the mask confirmation before the paid instruction controls", () => {
    const confirmation = source.indexOf("确认选区");
    const prompt = source.indexOf("把杯子改成蓝色陶瓷杯");
    const paid = source.indexOf("确认费用并生成");
    expect(confirmation).toBeGreaterThan(0);
    expect(prompt).toBeGreaterThan(confirmation);
    expect(paid).toBeGreaterThan(prompt);
    expect(source).toContain('data-testid="preview-object-mask-overlay"');
  });

  it("gets a signed quote before submitting and never auto-adopts the candidate", () => {
    const quote = source.indexOf("quoteInpaintMutation.mutateAsync");
    const submit = source.indexOf("inpaintMutation.mutateAsync");
    const candidate = source.indexOf('type: "candidate"');
    const adopt = source.indexOf("adoptMutation.mutateAsync");
    expect(quote).toBeGreaterThan(0);
    expect(submit).toBeGreaterThan(quote);
    expect(candidate).toBeGreaterThan(submit);
    expect(adopt).toBeGreaterThan(candidate);
  });

  it("keeps the video element mounted beneath a one-frame image and mask", () => {
    const video = source.indexOf("<video");
    const frameOverlay = source.indexOf(
      'data-testid="editing-preview-frame-overlay"'
    );
    const maskOverlay = source.indexOf(
      'data-testid="preview-object-mask-overlay"'
    );
    expect(video).toBeGreaterThan(0);
    expect(frameOverlay).toBeGreaterThan(video);
    expect(maskOverlay).toBeGreaterThan(frameOverlay);
  });

  it("captures a freehand lasso above media controls and never submits a raw box mask", () => {
    expect(source).toContain('data-testid="preview-object-mask-hit-layer"');
    expect(source).toContain("segmentRegionMutation.mutateAsync");
    expect(source).toContain(
      "maskCapabilitiesQuery.data?.semanticRegionSelection"
    );
    expect(source).toContain('data-testid="preview-object-mask-lasso"');
    expect(source).toContain("圈住要修改的物体");
    expect(source).not.toContain("segmentRectMutation.mutateAsync");
    expect(source).not.toContain("拖动框选区域");
  });

  it("explains that semantic recognition is required before any paid generation", () => {
    expect(source).toContain("当前未配置语义对象识别");
    expect(source).toContain("不会把圈选范围直接当成修改区域");
  });

  it("loads an existing succeeded candidate for the exact Preview target", () => {
    expect(source).toContain("latestInpaintCandidate.useQuery");
    expect(source).toContain('type: "restore-candidate"');
  });
});
