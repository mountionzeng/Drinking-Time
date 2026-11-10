import { beforeEach, expect, it, vi } from "vitest";
import { createStory, createGeneratedImage, getStoryById, updateStory, getStoryGeneratedImages, resetMemoryStateForTesting } from "../db";
import { ENV } from "../_core/env";
import { planArtPreviews, artPreviewGenerationInput, chooseArtPreview, readArtPreviews } from "./artPreview";
import { normalizeAudioState } from "../../shared/timelineAudioModel";
const mocks = vi.hoisted(() => ({ agent: vi.fn(), material: vi.fn(), audio: vi.fn() }));
vi.mock("./agentRuntime", () => ({ runJsonAgent: mocks.agent }));
vi.mock("./storyMaterials", () => ({ getStoryMaterialState: mocks.material }));
vi.mock("./storyAudioAssets", () => ({ listOwnedStoryAudioAssets: mocks.audio }));
beforeEach(() => {
  ENV.databaseUrl = ""; resetMemoryStateForTesting(); vi.clearAllMocks();
  mocks.agent.mockResolvedValue({ parsed: { shots: [1,2].map(n => ({ stableShotId: `s${n}`, brief: `specific frame ${n}`, adaptation: `迁移说明 ${n}` })) } });
  mocks.material.mockResolvedValue({ shots: [], timeline: { extensions: {} } });
  mocks.audio.mockResolvedValue([]);
});
async function fixture(userId = 1) {
  const story = await createStory({ userId, title: "test", body: { _revision: 1, custom: "preserved", shots: [1,2].map(n => ({ stableShotId: `s${n}`, shotNo: n, dialogue: `line ${n}`, promptDraft: `frame ${n}`, durationMs: 4000 })) } });
  const image = await createGeneratedImage({ storyId: story.id, userId, imageUrl: "/baseline.png", prompt: "baseline", isCurrent: false });
  return { storyId: story.id, userId, imageId: image.id, editorName: "作者", instruction: "迁移这一效果生成示意图", operationToken: crypto.randomUUID() };
}
async function patch(storyId: number, body: Record<string, unknown>) {
  const story = (await getStoryById(storyId, 1))!;
  await updateStory(storyId, 1, { body: { ...story.body as Record<string, unknown>, ...body } });
}
it("versions the plan with intent, authorship and one quote; replay does not infer again", async () => {
  const input = await fixture(); const batch = await planArtPreviews(input);
  expect(batch).toMatchObject({ version: 1, editorId: 1, editorName: "作者", instruction: input.instruction, baselineImageId: input.imageId, estimatedCny: 1.36 });
  expect(batch.createdAt).toBeGreaterThan(0);
  expect(await planArtPreviews(input)).toEqual(batch); expect(mocks.agent).toHaveBeenCalledTimes(1);
  await expect(planArtPreviews({ ...input, instruction: "other" })).rejects.toThrow("操作标识");
  const next = await planArtPreviews({ ...input, operationToken: crypto.randomUUID() });
  expect(next.version).toBe(2); expect(await readArtPreviews(input.storyId, 1)).toHaveLength(2);
  expect((await getStoryById(input.storyId, 1))?.body).toMatchObject({ custom: "preserved" });
  expect(await getStoryGeneratedImages(input.storyId, 1)).toHaveLength(1);
});
it("validates ownership, missing baseline and model shot identities before saving", async () => {
  const input = await fixture(); const foreign = await fixture(2);
  await expect(planArtPreviews({ ...input, userId: 2 })).rejects.toThrow("故事不存在");
  await expect(planArtPreviews({ ...input, imageId: foreign.imageId })).rejects.toThrow("不属于");
  await expect(planArtPreviews({ ...input, imageId: undefined })).rejects.toThrow("哪张效果图");
  expect(mocks.agent).not.toHaveBeenCalled();
  mocks.agent.mockResolvedValueOnce({ parsed: { shots: [{ stableShotId: "wrong", brief: "x", adaptation: "x" }] } });
  await expect(planArtPreviews(input)).rejects.toThrow("编号不匹配");
  expect(await readArtPreviews(input.storyId, 1)).toEqual([]);
});
it("uses only audible current music metadata and current dialogue, and rejects stale purchases", async () => {
  const input = await fixture();
  const audio = normalizeAudioState({ tracks: [{ kind: "music", clips: [{ id: "m", assetId: 17, timelineStartFrame: 0, sourceInFrame: 0, sourceOutFrame: 120, durationFrames: 120 }] }] });
  mocks.material.mockResolvedValue({ shots: [], timeline: { extensions: { audioTracks: audio } } });
  mocks.audio.mockResolvedValue([17,18].map(id => ({ id, status: "ready", mediaKind: "music", displayName: `music ${id}`, provenance: { prompt: "gentle" }, durationSeconds: 60 })));
  const batch = await planArtPreviews(input);
  const context = JSON.parse(mocks.agent.mock.calls[0][0].message);
  expect(context.music).toEqual([{ id: 17, name: "music 17", durationSeconds: 60, prompt: "gentle" }]);
  expect(context.shots.map((s: { dialogue: string }) => s.dialogue)).toEqual(["line 1", "line 2"]);
  expect(batch.musicContext).toContain("尚未做音频节拍检测");
  expect(await artPreviewGenerationInput(input.storyId, 1, batch.id, 2)).toMatchObject({ shot: { stableShotId: "s2" } });
  audio.tracks.find(t => t.kind === "music")!.muted = true;
  await expect(artPreviewGenerationInput(input.storyId, 1, batch.id, 2)).rejects.toThrow("已变化");
});
it("chooses only the requested batch/shot candidate and preserves the rest in the warehouse", async () => {
  const input = await fixture(); const batch = await planArtPreviews(input);
  const candidates = await Promise.all([1,2,3,4].map(n => createGeneratedImage({ storyId: input.storyId, userId: 1, imageUrl: `/preview${n}.png`, prompt: "preview", isCurrent: false })));
  await patch(input.storyId, { storyboardImageTasks: [{ requestId: batch.shots[1].requestId, status: "succeeded", result: { candidates: candidates.map(i => ({ imageId: i.id, imageUrl: i.imageUrl })) } }] });
  await expect(chooseArtPreview({ storyId: input.storyId, userId: 1, shotNo: 1, ordinal: 3 })).rejects.toThrow("没有找到");
  const choice = await chooseArtPreview({ storyId: input.storyId, userId: 1, shotNo: 2, ordinal: 3, version: 1 });
  expect(choice.imageId).toBe(candidates[2].id);
  const saved = await getStoryGeneratedImages(input.storyId, 1);
  expect(saved.find(i => i.id === choice.imageId)).toMatchObject({ isCurrent: true, shotIdentity: "s2", shotNo: "SH02" });
  expect(saved.filter(i => i.id !== choice.imageId).every(i => !i.isCurrent && !i.shotIdentity)).toBe(true);
  await patch(input.storyId, { shots: [{ shotNo: 2, stableShotId: "replacement", dialogue: "changed" }] });
  await expect(chooseArtPreview({ storyId: input.storyId, userId: 1, shotNo: 2, ordinal: 1 })).rejects.toThrow("已变化");
});
it("does not overwrite concurrent editing during planning", async () => {
  const input = await fixture();
  mocks.agent.mockImplementationOnce(async () => {
    await patch(input.storyId, { _revision: 2, custom: "new edit" });
    return { parsed: { shots: [1,2].map(n => ({ stableShotId: `s${n}`, brief: "x", adaptation: "x" })) } };
  });
  await expect(planArtPreviews(input)).rejects.toThrow("revision conflict");
  expect((await getStoryById(input.storyId, 1))?.body).toMatchObject({ custom: "new edit" });
});
