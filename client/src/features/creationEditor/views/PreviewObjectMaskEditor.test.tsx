import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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

  it("uses one effective Preview playhead for display, target resolution, and extraction", () => {
    expect(workspaceSource).toContain(
      "const previewPlayheadMs = playbackClock.playheadMs"
    );
    expect(workspaceSource).not.toContain("previewFrameEditPlayhead");
    expect(workspaceSource).not.toContain("timelineVideoSourceForSelectedShot");
    expect(workspaceSource).toMatch(
      /resolveTimelineVisualFrame\([\s\S]*?previewPlayheadMs/
    );
    expect(workspaceSource).toContain("playheadMs={previewPlayheadMs}");
    expect(workspaceSource).toMatch(
      /prepareCurrentVideoFrameForImageEdit[\s\S]*?resolveActiveVideoSource\(previewPlayheadMs\)/
    );
    expect(workspaceSource).toMatch(
      /prepareCurrentVideoFrameForImageEdit[\s\S]*?playbackClock\.setPlaying\(false\)/
    );
    expect(workspaceSource).toMatch(
      /prepareCurrentVideoFrameForImageEdit[\s\S]*?selectImageForChat\(target, \{ preservePlayhead: true \}\)/
    );
    expect(workspaceSource).toContain("timeline-frame:${target.clipId}");
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
    const frameOverlay = source.indexOf('data-testid="editing-preview-frame-overlay"');
    const maskOverlay = source.indexOf('data-testid="preview-object-mask-overlay"');
    expect(video).toBeGreaterThan(0);
    expect(frameOverlay).toBeGreaterThan(video);
    expect(maskOverlay).toBeGreaterThan(frameOverlay);
  });

  it("captures a freehand lasso above media controls and never submits a raw box mask", () => {
    expect(source).toContain('data-testid="preview-object-mask-hit-layer"');
    expect(source).toContain("segmentRegionMutation.mutateAsync");
    expect(source).toContain("maskCapabilitiesQuery.data?.semanticRegionSelection");
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
