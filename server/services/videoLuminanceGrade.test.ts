import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "";
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dt-luma-video-"));
const { ENV } = await import("../_core/env");
ENV.localImageDir = path.join(tmp, "images");
const { createStory } = await import("../repositories/stories");
const { createGeneratedImage } = await import("../repositories/images");
const { createVideoTake, getVideoTakeById } = await import("../repositories/videos");
const { resetMemoryStateForTesting } = await import("../repositories/runtime");
const { gradeVideoLuminance } = await import("./videoLuminanceGrade");
const { localVideoDir } = await import("./videoMedia");

const userId = 91;
let storyId: number;
let parentId: number;
let referenceId: number;
let fetchSpy: ReturnType<typeof vi.fn>;

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

beforeEach(async () => {
  resetMemoryStateForTesting();
  fetchSpy = vi.fn(async () => { throw new Error("network disabled in test"); });
  vi.stubGlobal("fetch", fetchSpy);
  fs.rmSync(localVideoDir(), { recursive: true, force: true }); // 只清测试自己的临时目录
  fs.mkdirSync(localVideoDir(), { recursive: true });
  const story = await createStory({ userId, title: "luma", body: { shots: [{ shotNo: 3, stableShotId: "s3", generationParams: { firstImageId: 0 } }] } });
  storyId = story.id;
  const bright = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 235, g: 228, b: 210 } } }).png().toBuffer();
  referenceId = (await createGeneratedImage({ storyId, userId, projectId: null, imageUrl: `data:image/png;base64,${bright.toString("base64")}`, imageKey: null, prompt: "ref", isCurrent: true, shotNo: "SH03", shotIdentity: "s3" })).id;
  const parent = await createVideoTake({ storyId, userId, stableShotId: "s3", sourceImageId: referenceId, status: "available", provider: "302", model: "viduq2-pro-fast", prompt: "p", durationSec: 1, aspectRatio: "1:1" });
  parentId = parent.id;
  if (hasFfmpeg) {
    // 1 秒、偏暗偏绿的小视频
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x3c5a2a:s=64x64:d=1:r=8,format=yuv420p", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(localVideoDir(), `take-${parentId}.mp4`)]);
    const { updateVideoTake } = await import("../repositories/videos");
    await updateVideoTake(parentId, userId, { videoKey: `take-${parentId}.mp4`, videoUrl: `/api/videos/take-${parentId}.mp4` });
  }
});

describe.skipIf(!hasFfmpeg)("gradeVideoLuminance (视频只调亮度)", () => {
  it("writes a brighter new Take for the same shot, keeps the original, spends nothing", async () => {
    const before = fs.readFileSync(path.join(localVideoDir(), `take-${parentId}.mp4`));
    const result = await gradeVideoLuminance({ storyId, userId, requestId: "req-video-0001", takeId: parentId, strength: "full" });
    expect(result).toMatchObject({ parentTakeId: parentId, referenceImageId: referenceId, strength: "full", replayed: false, shotNo: 3 });
    expect(result.metrics.lMeanAfter).toBeGreaterThan(result.metrics.lMeanBefore + 10);
    const take = (await getVideoTakeById(result.takeId, userId))!;
    expect(take).toMatchObject({ status: "available", provider: "local", model: "luminance-hsl-v1", stableShotId: "s3", videoKey: `take-${take.id}.mp4`, sourceImageId: referenceId });
    expect(take.parameterSnapshot).toMatchObject({ parentTakeId: parentId, computeUnits: 0, costCny: 0 });
    expect(fs.existsSync(path.join(localVideoDir(), take.videoKey!))).toBe(true);
    expect(fs.readFileSync(path.join(localVideoDir(), `take-${parentId}.mp4`)).equals(before)).toBe(true);
    expect((await getVideoTakeById(parentId, userId))!.status).toBe("available");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("finds the latest take by shot number and replays the same request without re-encoding", async () => {
    const first = await gradeVideoLuminance({ storyId, userId, requestId: "req-video-0002", shotNo: 3, strength: "mid" });
    const again = await gradeVideoLuminance({ storyId, userId, requestId: "req-video-0002", shotNo: 3, strength: "mid" });
    expect(again).toMatchObject({ takeId: first.takeId, replayed: true });
  });

  it("never overwrites an existing file, and marks the new take failed", async () => {
    const { getStoryVideoTakes } = await import("../repositories/videos");
    const nextId = Math.max(...(await getStoryVideoTakes(storyId, userId)).map(t => t.id)) + 1;
    const blocker = path.join(localVideoDir(), `take-${nextId}.mp4`);
    fs.writeFileSync(blocker, "keep me");
    await expect(gradeVideoLuminance({ storyId, userId, requestId: "req-video-0003", takeId: parentId, strength: "mid" })).rejects.toThrow(/已存在，未覆盖/);
    expect(fs.readFileSync(blocker, "utf8")).toBe("keep me");
    expect((await getVideoTakeById(nextId, userId))!.status).toBe("failed");
  });

  it("refuses takes from other stories or without a local file", async () => {
    await expect(gradeVideoLuminance({ storyId, userId: 999, requestId: "req-video-0004", takeId: parentId, strength: "mid" })).rejects.toThrow(/故事不存在/);
    const remote = await createVideoTake({ storyId, userId, stableShotId: "s3", sourceImageId: referenceId, status: "available", provider: "302", model: "m", prompt: "p", videoUrl: "https://cdn.example/v.mp4" });
    await expect(gradeVideoLuminance({ storyId, userId, requestId: "req-video-0005", takeId: remote.id, strength: "mid" })).rejects.toThrow(/没有本机文件/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
