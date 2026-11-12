import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "";
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dt-region-video-"));
const { ENV } = await import("../_core/env");
ENV.localImageDir = path.join(tmp, "images");
const { createStory } = await import("../repositories/stories");
const { createVideoTake, getVideoTakeById, updateVideoTake } = await import("../repositories/videos");
const { resetMemoryStateForTesting } = await import("../repositories/runtime");
const { localVideoDir } = await import("./videoMedia");
const { hslSaturation, rgb01ToLab } = await import("./luminanceGrade");
const { gradeVideoRegion, planCopyCut, regionalPixel, resolveRegionalWindow, subjectWeight } = await import("./videoRegionalGrade");

const spec = { subject: "forest" as const, deltaL: 5, protectHighlights: true };
const hue = (r: number, g: number, b: number) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

describe("regional forest darken (pixel math)", () => {
  it("lowers Lab L by ΔL on forest greens while HSL hue and S stay exact", () => {
    for (const c of [[0.2, 0.45, 0.3], [0.1, 0.3, 0.15], [0.05, 0.2, 0.1], [0.5, 0.7, 0.4], [0.45, 0.62, 0.2]] as [number, number, number][]) {
      const out = regionalPixel(spec, ...c);
      const w = subjectWeight("forest", ...c);
      expect(rgb01ToLab(...out)[0]).toBeCloseTo(rgb01ToLab(...c)[0] - 5 * w, 1);
      expect(hslSaturation(...out)).toBeCloseTo(hslSaturation(...c), 5);
      expect(hue(...out)).toBeCloseTo(hue(...c), 3);
    }
  });

  it("leaves the white paper plane, pink/blue clouds, sky and sandy ground untouched", () => {
    for (const c of [[0.97, 0.97, 0.96], [0.92, 0.93, 0.95], [0.98, 0.72, 0.7], [0.55, 0.62, 0.95], [0.93, 0.8, 0.55]] as [number, number, number][])
      expect(regionalPixel(spec, ...c)).toEqual(c);
  });

  it("finds the forest window and intersects it with the asked half", () => {
    const presence = [0, 0, 0, 0.05, 0.2, 0.3, 0.3, 0.3, 0.25, 0.2, 0.15, 0.1];
    expect(resolveRegionalWindow({ presence, sampleFps: 2, durationSec: 6, window: "second-half" })).toMatchObject({ startSec: 3, endSec: 6, subjectStart: 2 });
    expect(resolveRegionalWindow({ presence, sampleFps: 2, durationSec: 6, window: "first-half" })).toMatchObject({ startSec: 2, endSec: 3 });
    expect(resolveRegionalWindow({ presence: presence.map(() => 0), sampleFps: 2, durationSec: 6, window: "whole" })).toBeNull();
  });

  it("copies whole mini-GOPs only: up to an anchor, packets in decode order", () => {
    // 显示序 I0 B1 B2 B3 P4 B5 B6 B7 P8 B9 B10 B11 P12 …；解码序 I0 P4 B2 B1 B3 P8 B6 B5 B7 P12 …
    const frames = Array.from({ length: 16 }, (_, i) => ({ pts: i, type: i % 4 === 0 ? (i ? "P" : "I") : "B" }));
    const order = [0, 4, 2, 1, 3, 8, 6, 5, 7, 12, 10, 9, 11, 15, 14, 13];
    const packets = order.map(pts => ({ pts, dts: pts }));
    expect(planCopyCut(frames, packets, 8)).toEqual({ copyFrames: 9, copyPackets: 9 });
    expect(planCopyCut(frames, packets, 6)).toEqual({ copyFrames: 9, copyPackets: 9 });
    expect(planCopyCut(frames, packets, 15)).toBeNull();
  });
});

const userId = 92;
let storyId: number;
let parentId: number;
let fetchSpy: ReturnType<typeof vi.fn>;
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
beforeEach(async () => {
  resetMemoryStateForTesting();
  fetchSpy = vi.fn(async () => { throw new Error("network disabled in test"); });
  vi.stubGlobal("fetch", fetchSpy);
  fs.rmSync(localVideoDir(), { recursive: true, force: true });
  fs.mkdirSync(localVideoDir(), { recursive: true });
  storyId = (await createStory({ userId, title: "region", body: { shots: [{ shotNo: 3, stableShotId: "s3" }] } })).id;
  parentId = (await createVideoTake({ storyId, userId, stableShotId: "s3", sourceImageId: null, status: "available", provider: "local", model: "luminance-hsl-v1", prompt: "p", durationSec: 4, aspectRatio: "1:1" })).id;
  if (hasFfmpeg) {
    // 前 2 秒沙色，后 2 秒森林绿中间一块白（纸飞机）；带 B 帧，和真实片子一样。
    const file = path.join(localVideoDir(), `take-${parentId}.mp4`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0xe0c890:s=96x96:d=2:r=12", "-f", "lavfi", "-i", "color=c=0x3c7a3a:s=96x96:d=2:r=12",
      "-filter_complex", "[1:v]drawbox=x=40:y=40:w=16:h=16:color=0xf6f6f4:t=fill[f];[0:v][f]concat=n=2:v=1:a=0,noise=alls=6:allf=t,format=yuvj420p[v]", "-map", "[v]",
      "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-bf", "3", file]);
    await updateVideoTake(parentId, userId, { videoKey: `take-${parentId}.mp4`, videoUrl: `/api/videos/take-${parentId}.mp4` });
  }
});

describe.skipIf(!hasFfmpeg)("gradeVideoRegion (后半段森林压暗)", () => {
  it("darkens only the forest in the second half, keeps the first half byte-identical, writes a new Take", async () => {
    const before = fs.readFileSync(path.join(localVideoDir(), `take-${parentId}.mp4`));
    const result = await gradeVideoRegion({ storyId, userId, requestId: "req-region-001", takeId: parentId, subject: "forest", window: "second-half", deltaL: 5, protectHighlights: true, instruction: "t" });
    expect(result.metrics.copiedFramesIdentical).toBe(true);
    expect(result.metrics.copiedFrames).toBeGreaterThanOrEqual(24);
    expect(result.metrics.windowStartSec).toBeGreaterThanOrEqual(2);
    expect(result.metrics.forestLBefore - result.metrics.forestLAfter).toBeGreaterThan(3.5);
    expect(result.metrics.forestLBefore - result.metrics.forestLAfter).toBeLessThan(6.5);
    expect(Math.abs(result.metrics.highlightLBefore - result.metrics.highlightLAfter)).toBeLessThan(1);
    expect(result.metrics.clipWhiteAfter).toBeLessThanOrEqual(result.metrics.clipWhiteBefore);
    const take = (await getVideoTakeById(result.takeId, userId))!;
    expect(take).toMatchObject({ status: "available", provider: "local", model: "regional-luma-hsl-v1", stableShotId: "s3" });
    expect(take.parameterSnapshot).toMatchObject({ parentTakeId: parentId, computeUnits: 0, costCny: 0 });
    expect(fs.readFileSync(path.join(localVideoDir(), `take-${parentId}.mp4`)).equals(before)).toBe(true);
    const again = await gradeVideoRegion({ storyId, userId, requestId: "req-region-001", takeId: parentId, subject: "forest", window: "second-half", deltaL: 5, protectHighlights: true, instruction: "t" });
    expect(again).toMatchObject({ takeId: result.takeId, replayed: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("asks which take when a shot has several and none is selected", async () => {
    await createVideoTake({ storyId, userId, stableShotId: "s3", sourceImageId: null, status: "available", provider: "302", model: "x", prompt: "p", durationSec: 4, aspectRatio: "1:1", videoKey: "take-x.mp4" } as never);
    await expect(gradeVideoRegion({ storyId, userId, requestId: "req-region-002", shotNo: 3, subject: "forest", window: "second-half", deltaL: 5, protectHighlights: true, instruction: "t" }))
      .rejects.toThrow(/有 2 条视频/);
  });

  it("refuses when the asked window has no forest, and never overwrites files", async () => {
    await expect(gradeVideoRegion({ storyId, userId, requestId: "req-region-003", takeId: parentId, subject: "forest", window: "first-half", deltaL: 5, protectHighlights: true, instruction: "t" }))
      .rejects.toThrow(/没有看到森林/);
  });
});
