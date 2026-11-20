import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { ENV } from "./_core/env";
import { createVideoTake, getStoryTimeline, getStoryVideoTimelineSelections, getVideoTakeById, resetMemoryStateForTesting, updateStoryTimeline } from "./db";
import { appRouter } from "./routers";
import { getStoryMaterialState } from "./services/storyMaterials";
import { restoreVisualRevision } from "./services/storyVisualObjectEditing";
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
  it("swaps only the primary source, persists the trim and permits an exact inverse", async () => {
    const { storyId, original, graded } = await seed();
    const api=caller().warehouseVideoSequence;
    const command={storyId,stableShotId:"sh-03",takeId:graded,expectedTakeId:original,expectedVersion:1};
    await expect(api.replacePrimary(command)).rejects.toThrow("不能覆盖");
    expect(await getStoryVideoTimelineSelections(storyId,USER)).toEqual([]);
    const before=(await getStoryTimeline(storyId,USER))!;
    const item=(before.items as VisualEditDocument["items"])[0];
    const trimmed={...item,timelineStartFrame:55,visualLayer:2,durationFrames:90,plannedDurationMs:3000,
      primaryVideoEdit:{...item.primaryVideoEdit!,sourceStartSec:2,sourceEndSec:5}};
    await updateStoryTimeline({storyId,userId:USER,expectedVersion:1,items:[trimmed]});
    await expect(api.replacePrimary(command)).rejects.toThrow("已更新");
    await api.replacePrimary({...command,expectedVersion:2});
    await api.replacePrimary({...command,expectedVersion:2});
    const after=(await getStoryTimeline(storyId,USER))!;
    expect(after.version).toBe(3);
    expect(after.items).toEqual([{...trimmed,primaryVideoEdit:{...trimmed.primaryVideoEdit,takeId:graded}}]);
    expect(await getStoryVideoTimelineSelections(storyId,USER)).toMatchObject([{takeId:graded,selectionType:"range"}]);
    await api.replacePrimary({...command,takeId:original,expectedVersion:3,expectedTakeId:graded});
    expect((await getStoryTimeline(storyId,USER))?.items).toEqual([trimmed]);
    expect(await getStoryVideoTimelineSelections(storyId,USER)).toMatchObject([{takeId:original}]);
  });
  it.each([{ gap: 240, layer: 0, start: 60 }, { gap: 90, layer: 2, start: 60 }])(
    "saves the complete cut with a $gap-frame gap, survives retries and restores the original", async ({ gap, layer, start }) => {
      const { storyId, original, graded } = await seed();
      const api = caller().warehouseVideoSequence;
      const row = ((await getStoryTimeline(storyId, USER))!.items as VisualEditDocument["items"])[0];
      const story = await caller().storyAgent.storyGet({ id: storyId });
      const body = story!.body as { shots: Record<string,unknown>[]; _revision: number };
      await caller().storyAgent.storyUpsert({ id: storyId, baseRevision: body._revision, body: { ...body, shots: [
        { shotNo: 1, shotKey: "custom-intro", stableShotId: "prior" }, { ...body.shots[0], shotNo: 2, shotKey: "SH02" },
      ] } });
      const prior = { ...row, stableShotId: "prior", timelineStartFrame: 0, position: 0, durationFrames: 60, plannedDurationMs: 2000 };
      const ending = { ...row, timelineStartFrame: 60 + gap, position: 1 };
      const items = [prior, ending];
      await updateStoryTimeline({ storyId, userId: USER, expectedVersion: 1, items, visualLayerState: {count:2, hidden:[1]} });
      const command = { storyId, stableShotId: "sh-03", takeId: graded, expectedTakeId: original, expectedVersion: 2 };
      await expect(api.saveReviewedTake({ ...command, expectedVersion: 1 })).rejects.toThrow("已更新");
      const [first, retry] = await Promise.all([api.saveReviewedTake(command), api.saveReviewedTake(command)]);
      expect(first).toMatchObject({ startFrame:start, layer, shotNo:2, takeId:graded });
      expect(retry.stableShotId).toBe(first.stableShotId);
      const placed = (await getStoryTimeline(storyId, USER))!;
      expect(placed.version).toBe(3);
      expect(placed.items).toEqual([prior, expect.objectContaining({ stableShotId:first.stableShotId, timelineStartFrame:start,
        durationFrames:240, visualLayer:layer, primaryVideoEdit:expect.objectContaining({takeId:graded,sourceStartSec:0,sourceEndSec:8}) }),
        { ...ending, position:2 }]);
      const savedStory = (await caller().storyAgent.storyGet({ id: storyId }))!;
      const savedBody = savedStory.body as { _revision: number; shots: Record<string,unknown>[] };
      const savedAgain = (await caller().storyAgent.storyUpsert({id:storyId, baseRevision:savedBody._revision,
        body:{ ...savedBody, shots:savedBody.shots.map(({shotKey: _editorKey, ...shot}) => shot) }}))!;
      expect((savedAgain.body as typeof savedBody).shots.map(shot => shot.shotKey)).toEqual(["custom-intro","SH02","SH03"]);
      const materials = await getStoryMaterialState(storyId, USER);
      expect(materials?.shots.find(s => s.stableShotId === first.stableShotId)?.currentVideo?.id).toBe(graded);
      expect(materials?.shots.find(s => s.stableShotId === "sh-03")?.currentVideo?.id).toBe(original);
      expect(await restoreVisualRevision({storyId, userId:USER, expectedTimelineVersion:3, version:2,
        operation:{operationId:"undo-full-review-" + gap, editorSessionEpoch:"test"}})).toMatchObject({status:"ok"});
      expect((await getStoryTimeline(storyId, USER))!.items).toEqual(items);
      expect((await getStoryMaterialState(storyId, USER))?.shots.map(s=>s.stableShotId)).toEqual(["prior","sh-03"]);
    }
  );

  it("places an overlong candidate in full above an occupied slot, leaving its primary in place", async () => {
    const { storyId, original, graded } = await seed();
    const row = ((await getStoryTimeline(storyId, USER))!.items as VisualEditDocument["items"])[0];
    await updateStoryTimeline({storyId, userId:USER, expectedVersion:1, items:[{...row, durationFrames:90,
      plannedDurationMs:3000, primaryVideoEdit:{...row.primaryVideoEdit!, sourceStartSec:2,sourceEndSec:5}}]});
    const saved = await caller().warehouseVideoSequence.saveReviewedTake({storyId, stableShotId:"sh-03", takeId:graded, expectedTakeId:original, expectedVersion:2});
    expect(saved).toMatchObject({layer:1,startFrame:0});
    const items = (await getStoryTimeline(storyId, USER))!.items as VisualEditDocument["items"];
    expect(items.map(row=>[row.visualLayer,row.durationFrames,row.primaryVideoEdit?.takeId])).toEqual([[1,240,graded],[0,90,original]]);
  });

  it("places the first reviewed video in a still-only shot, survives reload and restores the original still-only edit", async () => {
    const { storyId, original, graded } = await seed();
    const before = (await getStoryTimeline(storyId, USER))!;
    const { primaryVideoEdit: _old, ...item } = (before.items as VisualEditDocument["items"])[0];
    const still = { id: "opening", imageId: 99, imageUrl: "/forest.png", label: "开场", offsetFrames: 0, timelineStartFrame: 788, durationFrames: 30, visualLayer: 0 };
    const empty = { ...item, timelineStartFrame: 788, durationFrames: 90, plannedDurationMs: 3000, imageClips: [still] };
    const next = { ...item, stableShotId: "next", position: 1, timelineStartFrame: 1500 };
    const items = [empty, next];
    await updateStoryTimeline({ storyId, userId: USER, expectedVersion: 1, items });
    const command = { storyId, stableShotId: "sh-03", expectedTakeId: null, takeId: graded, expectedVersion: 2 };
    const api = caller().warehouseVideoSequence;
    await expect(api.replacePrimary({ ...command, expectedVersion: 1 })).rejects.toThrow("已更新");
    await expect(api.replacePrimary({ ...command, stableShotId: "next" })).rejects.toThrow("不可用");
    await Promise.all([api.replacePrimary(command), api.replacePrimary(command)]);
    await expect(api.replacePrimary({ ...command, takeId: original })).rejects.toThrow("已更新");
    const placed = (await getStoryTimeline(storyId, USER))!;
    expect(placed.version).toBe(3);
    expect(placed.items).toMatchObject([{ ...empty, durationFrames: 240, plannedDurationMs: 8000, primaryVideoEdit: { takeId: graded, sourceStartSec: 0, sourceEndSec: 8 } }, next]);
    const current = async () => (await getStoryMaterialState(storyId, USER))?.shots.find(s => s.stableShotId === "sh-03")?.currentVideo?.id;
    expect(await current()).toBe(graded);
    expect(await restoreVisualRevision({ storyId, userId: USER, expectedTimelineVersion: 3, version: 2, operation: {operationId:"undo-review-save", editorSessionEpoch:"new-session"} })).toMatchObject({status:"ok"});
    expect((await getStoryTimeline(storyId, USER))!.items).toEqual(items);
    expect(await current()).toBeUndefined();
    expect(await getVideoTakeById(graded, USER)).toMatchObject({status:"available"});
  });

  it.each([false, true])("keeps the following shot in place when its start is implicit=%s", async implicit => {
    const { storyId, graded } = await seed();
    const before = (await getStoryTimeline(storyId, USER))!;
    const { primaryVideoEdit: _old, ...item } = (before.items as VisualEditDocument["items"])[0];
    const empty = { ...item, timelineStartFrame: 0, durationFrames: 90, plannedDurationMs: 3000 };
    const next = { ...empty, stableShotId: "next", position: 1, timelineStartFrame: implicit ? undefined : 150 };
    await updateStoryTimeline({ storyId, userId: USER, expectedVersion: 1, items: [empty, next] });
    await caller().warehouseVideoSequence.replacePrimary({ storyId, stableShotId: "sh-03", expectedTakeId: null, takeId: graded, expectedVersion: 2 });
    const placed = (await getStoryTimeline(storyId, USER))!.items as VisualEditDocument["items"];
    expect(placed[0].primaryVideoEdit?.sourceEndSec).toBe(implicit ? 3 : 5);
    expect(placed[0].durationFrames).toBe(implicit ? 90 : 150);
    expect(placed[1]).toEqual(next);
  });

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
