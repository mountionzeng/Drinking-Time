import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import {
  DEFAULT_TIMELINE_TRANSFORM,
  DEFAULT_TIMELINE_VIDEO_EFFECTS,
} from "../../shared/storyMaterial";
import type { TrpcContext } from "../_core/context";
import { ENV } from "../_core/env";
import {
  createStory,
  createVideoTake,
  createStoryAudioAssetRow,
  getStoryTimeline,
  resetMemoryStateForTesting,
  setVideoTimelineSelection,
  updateStoryTimeline,
} from "../db";
import { appRouter } from "../routers";
import { resolveManagedAudioPath } from "./audioMedia";
import { getStoryMaterialState } from "./storyMaterials";
import { buildExportPlan, exportStoryTimeline } from "./videoExport";

const temp = mkdtempSync(path.join(os.tmpdir(), "dialogue-sync-"));
const videos = path.join(temp, "videos");
const userId = 745;
const databaseUrl = ENV.databaseUrl;
const imageDir = ENV.localImageDir;
const api = appRouter.createCaller({
  user: { id: userId },
  req: { headers: {} },
  res: {},
} as TrpcContext);
const ffmpeg = (args: string[]) =>
  execFileSync("ffmpeg", ["-nostdin", "-v", "error", ...args], {
    maxBuffer: 8 * 1024 * 1024,
  });
afterAll(() => {
  ENV.databaseUrl = databaseUrl;
  ENV.localImageDir = imageDir;
  vi.unstubAllEnvs();
  rmSync(temp, { recursive: true, force: true });
});

it("aligns a visible 24fps entrance to recorded speech in chat, reloads, exports and restores the original cut", async () => {
  ENV.databaseUrl = "";
  ENV.localImageDir = path.join(temp, "images");
  vi.stubEnv("LOCAL_AUDIO_DIR", path.join(temp, "audio"));
  resetMemoryStateForTesting();
  mkdirSync(videos);
  mkdirSync(path.join(temp, "audio"));

  const stableShotId = "intro";
  const story = await createStory({
    userId,
    title: "入画时间验证",
    body: { shots: [{ stableShotId, shotNo: 1, durationSec: 6 }] },
  });
  const scope = { storyId: story.id, userId };
  const take = await createVideoTake({
    ...scope,
    stableShotId,
    status: "available",
    provider: "local-import",
    model: "original",
    prompt: "原片茶杯入画",
    durationSec: 6,
    videoKey: "cup.mp4",
    videoUrl: "/api/videos/cup.mp4",
  });
  await setVideoTimelineSelection({
    ...scope,
    stableShotId,
    takeId: take.id,
    selectionType: "full_take",
  });
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=0xbad4d9:s=240x240:r=24:d=6",
    "-i",
    "docs/prototypes/liaohuier-miniapp/assets/cup-fire.png",
    "-filter_complex",
    "[1:v]scale=64:64[cup];[0:v][cup]overlay=(W-w)/2:(H-h)/2:enable='gte(n,94)'",
    "-an",
    "-pix_fmt",
    "yuv420p",
    "-c:v",
    "libx264",
    path.join(videos, "cup.mp4"),
  ]);
  const key = "a".repeat(32);
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=12000:duration=6",
    "-af",
    "adelay=1600S",
    "-t",
    "6",
    "-f",
    "wav",
    resolveManagedAudioPath(key),
  ]);
  const audio = await createStoryAudioAssetRow({
    ...scope,
    storageKey: key,
    displayName: "对白",
    sourceKind: "local-upload",
    status: "ready",
    durationFrames: 180,
  });
  const item = {
    stableShotId,
    position: 0,
    included: true,
    plannedDurationMs: 6000,
    durationFrames: 180,
    timelineStartFrame: 0,
    transform: DEFAULT_TIMELINE_TRANSFORM,
    primaryVideoEdit: {
      takeId: take.id,
      sourceStartSec: 0,
      sourceEndSec: 6,
      effects: { ...DEFAULT_TIMELINE_VIDEO_EFFECTS, muted: true },
    },
  };
  const extensions = {
    subtitleTracks: {
      tracks: [
        {
          id: "en",
          cues: [
            { id: "cue", text: "Hello", startFrame: 2, durationFrames: 36 },
          ],
        },
      ],
    },
    audioTracks: {
      tracks: [
        {
          kind: "narration",
          clips: [
            {
              id: "speech",
              assetId: audio.id,
              timelineStartFrame: 0,
              sourceInFrame: 0,
              sourceOutFrame: 180,
            },
          ],
        },
      ],
    },
  };
  await updateStoryTimeline({
    ...scope,
    expectedVersion: 0,
    items: [item],
    extensions,
  });
  const command = {
    storyId: story.id,
    instruction:
      "我希望第一镜的小茶杯出现的快一点，随着第一句台词出现，他就出现",
  };
  const applied = await api.creationAgent.timelineEditCommand(command);
  expect(applied).toMatchObject({
    handled: true,
    appliedCount: 1,
    reply: expect.stringContaining("0.13 秒"),
  });
  const saved = await getStoryTimeline(story.id, userId);
  expect(saved?.version).toBe(2);
  expect(saved?.extensions).toMatchObject(extensions);
  const material = (await getStoryMaterialState(story.id, userId))!;
  const plan = buildExportPlan(material);
  expect(plan.totalFrames).toBe(180);
  expect(plan.parts).toHaveLength(1);
  const part = plan.parts[0];
  expect(part.kind).toBe("source");
  if (part.kind !== "source") throw new Error("原片未进入导出计划");
  expect(part.startSec + (part.effects.playbackRate * 4) / 30).toBeCloseTo(
    94 / 24,
    6,
  );
  expect(await api.creationAgent.timelineEditCommand(command)).toMatchObject({
    appliedCount: 0,
  });
  expect((await getStoryTimeline(story.id, userId))?.version).toBe(2);
  const result = await exportStoryTimeline({
    ...scope,
    targetAspectRatio: "1:1",
  });
  expect(result.status, JSON.stringify(result)).toBe("ok");
  if (result.status !== "ok") throw new Error("未生成成片");
  const file = path.join(videos, result.videoKey);
  const pixels = ffmpeg([
    "-i",
    file,
    "-an",
    "-t",
    "0.5",
    "-vf",
    "scale=64:64",
    "-pix_fmt",
    "rgb24",
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
  const pictureFrame = Array.from({ length: 15 }, (_, i) =>
    pixels.subarray(i * 64 * 64 * 3, (i + 1) * 64 * 64 * 3),
  ).findIndex((frame) => {
    let red = 0;
    for (let j = 0; j < frame.length; j += 3)
      if (frame[j] > frame[j + 1] + 30 && frame[j] > frame[j + 2] + 30) red++;
    return red >= 6;
  });
  const wave = ffmpeg([
    "-i",
    file,
    "-vn",
    "-t",
    "0.5",
    "-ac",
    "1",
    "-ar",
    "12000",
    "-f",
    "s16le",
    "pipe:1",
  ]);
  const speechFrame = Array.from({ length: 15 }, (_, i) =>
    wave.subarray(i * 800, (i + 1) * 800),
  ).findIndex((block) => {
    let energy = 0;
    for (let j = 0; j < block.length; j += 2)
      energy += (block.readInt16LE(j) / 32768) ** 2;
    return energy / 400 > 10 ** -4.2;
  });
  expect(speechFrame).toBe(4);
  expect(pictureFrame).toBe(4);
  expect(
    await api.creationAgent.restoreVisualRevision({
      storyId: story.id,
      version: 1,
      expectedTimelineVersion: 2,
      operation: {
        editorSessionEpoch: "sync-test",
        operationId: "restore-cup",
      },
    }),
  ).toMatchObject({ status: "ok" });
  const restored = await getStoryTimeline(story.id, userId);
  expect(restored?.items).toEqual([item]);
  expect(restored?.extensions).toMatchObject(extensions);
}, 30000);
