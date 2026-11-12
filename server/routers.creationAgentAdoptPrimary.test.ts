import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { ENV } from "./_core/env";
import { createVideoTake, getStoryTimeline, getStoryVideoTimelineSelections, getVideoTakeById, resetMemoryStateForTesting, updateStoryTimeline } from "./db";
import { appRouter } from "./routers";
import type { VisualEditDocument } from "../shared/visualClipModel";

const USER = 731;
const savedDatabaseUrl = ENV.databaseUrl;
const savedImageDir = ENV.localImageDir;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dt-adopt-primary-"));
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const TRANSFORM = { cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1, zoom: 1, panX: 0, panY: 0 };

const caller = () => appRouter.createCaller({
  user: { id: USER, openId: `adopt-${USER}`, email: "a@example.com", name: "A", loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
} as TrpcContext);

beforeEach(() => { ENV.databaseUrl = ""; ENV.localImageDir = path.join(tmp, "images"); resetMemoryStateForTesting(); });
afterEach(() => { ENV.databaseUrl = savedDatabaseUrl; ENV.localImageDir = savedImageDir; });
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function seed() {
  const story = await caller().storyAgent.storyUpsert({ title: "采用主视频", body: { shots: [{ shotNo: 3, stableShotId: "sh-03", durationSec: 14.5 }] } });
  if (!story) throw new Error("story creation failed");
  const original = await createVideoTake({ storyId: story.id, userId: USER, stableShotId: "sh-03", status: "available", provider: "local-import", model: "chatcut-original", prompt: "ChatCut 原素材", durationSec: 14.5, videoUrl: "/api/videos/take-a.mp4" });
  const graded = await createVideoTake({ storyId: story.id, userId: USER, stableShotId: "sh-03", status: "available", provider: "local", model: "regional-luma-hsl-v1", prompt: "后半段森林压暗", durationSec: 8, videoUrl: "/api/videos/take-b.mp4" });
  await updateStoryTimeline({ storyId: story.id, userId: USER, expectedVersion: 0, items: [{
    stableShotId: "sh-03", included: true, position: 0, plannedDurationMs: 14500, durationFrames: 435, timelineStartFrame: 0, visualLayer: 0, transform: TRANSFORM,
    primaryVideoEdit: { takeId: original.id, sourceStartSec: 0, sourceEndSec: 14.5, effects: { playbackRate: 1, reverse: false, volume: 1, muted: true } },
  }] });
  return { storyId: story.id, original: original.id, graded: graded.id };
}

describe("creationAgent.adoptVideoTake replacePrimary（对话「采用视频 Take N」）", () => {
  it("serializes competing adoptions so the selection and primary cannot diverge", async () => {
    const { storyId, original, graded } = await seed();
    const results = await Promise.all([graded, original, graded].map(takeId =>
      caller().creationAgent.adoptVideoTake({storyId, stableShotId: "sh-03", takeId, plannedDurationSec: 8})
    ));
    expect(results.every(result => result.status === "ok")).toBe(true);
    const selection = (await getStoryVideoTimelineSelections(storyId, USER))[0];
    const item = ((await getStoryTimeline(storyId, USER))!.items as VisualEditDocument["items"])[0];
    expect(selection.takeId).toBe(graded);
    expect(item.primaryVideoEdit?.takeId).toBe(selection.takeId);
  });
  it("rejects a take belonging to another user before touching selection or primary", async () => {
    const { storyId, original } = await seed();
    const foreign = await createVideoTake({ storyId, userId: USER + 1, stableShotId: "sh-03", status: "available", provider: "local", model: "test", prompt: "foreign fixture", durationSec: 8, videoUrl: "/foreign.mp4" });
    expect(await caller().creationAgent.adoptVideoTake({storyId, stableShotId: "sh-03", takeId: foreign.id, plannedDurationSec: 8})).toMatchObject({status:"error"});
    expect(await getStoryVideoTimelineSelections(storyId, USER)).toEqual([]);
    const item = ((await getStoryTimeline(storyId, USER))!.items as VisualEditDocument["items"])[0];
    expect(item.primaryVideoEdit?.takeId).toBe(original);
  });
  it("swaps the shot's primary video to the adopted take, keeping effects, transform and every take", async () => {
    const { storyId, original, graded } = await seed();
    const result = await caller().creationAgent.adoptVideoTake({ storyId, stableShotId: "sh-03", takeId: graded, plannedDurationSec: 8, replacePrimary: true });
    expect(result).toMatchObject({ status: "ok", primaryReplaced: true });
    const item = ((await getStoryTimeline(storyId, USER))!.items as VisualEditDocument["items"]).find(entry => entry.stableShotId === "sh-03")!;
    expect(item.primaryVideoEdit).toMatchObject({ takeId: graded, sourceStartSec: 0, sourceEndSec: 8, effects: { muted: true, playbackRate: 1 } });
    expect(item.transform).toMatchObject(TRANSFORM);
    expect(item.durationFrames).toBe(240);
    expect(await getVideoTakeById(original, USER)).toMatchObject({ status: "available" });
    // 再说一次：已经是主视频，不再写。
    expect(await caller().creationAgent.adoptVideoTake({ storyId, stableShotId: "sh-03", takeId: graded, plannedDurationSec: 8, replacePrimary: true }))
      .toMatchObject({ status: "ok", primaryReplaced: false });
  });

  it("also replaces the primary for warehouse and NLE adoption without a special flag", async () => {
    const { storyId, original, graded } = await seed();
    expect(await caller().creationAgent.adoptVideoTake({ storyId, stableShotId: "sh-03", takeId: graded, plannedDurationSec: 8 })).toMatchObject({ status: "ok" });
    const item = ((await getStoryTimeline(storyId, USER))!.items as VisualEditDocument["items"]).find(entry => entry.stableShotId === "sh-03")!;
    expect(item.primaryVideoEdit?.takeId).toBe(graded);
    expect(await getVideoTakeById(original, USER)).toMatchObject({ status: "available" });
  });
});

describe.skipIf(!hasFfmpeg)("creationAgent.importStoryMaterial video duration", () => {
  it("records the ffprobe duration instead of the shot's planned length", async () => {
    const story = await caller().storyAgent.storyUpsert({ title: "导入时长", body: { shots: [{ shotNo: 3, stableShotId: "sh-03", durationSec: 14.5 }] } });
    if (!story) throw new Error("story creation failed");
    const file = path.join(tmp, "clip.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=green:s=64x64:d=2.5:r=24", "-pix_fmt", "yuv420p", file]);
    const result = await caller().creationAgent.importStoryMaterial({ storyId: story.id, fileName: "clip.mp4", mimeType: "video/mp4",
      fileBase64: fs.readFileSync(file).toString("base64"), targetStableShotId: "sh-03" });
    expect(result).toMatchObject({ status: "ok", kind: "video" });
    if (result.status !== "ok" || result.kind !== "video") throw new Error("import failed");
    const take = await getVideoTakeById(result.takeId, USER);
    expect(take?.durationSec).toBeCloseTo(2.5, 1);
    expect(take?.aspectRatio).toBe("1:1");
    expect(result.plannedDurationSec).toBeCloseTo(2.5, 1);
  });
});
