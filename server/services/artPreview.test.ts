import { beforeEach, expect, it, vi } from "vitest";
import { createStory, createGeneratedImage, getStoryById, updateStory, getStoryGeneratedImages, resetMemoryStateForTesting } from "../db";
import { ENV } from "../_core/env";
import { planArtPreviews, artPreviewGenerationInput, chooseArtPreview, readArtPreviews, readPreviewArtBasis, retryPreviewPlan } from "./artPreview";
import { warehouseImageAttempts } from "./reviewedImageRetry";
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
it("includes only this shot's confirmed staging and rejects a quote after its staging changes", async () => {
  const input = await fixture();
  const direction = { stableShotId: "s1", confirmed: "One sailor above waves. The cyclist below looks up." };
  await patch(input.storyId, { shotSceneDirections: [direction, { stableShotId: "s2", confirmed: "Lone skater." }] });
  const batch = await planArtPreviews({ ...input, sampleShotIds: ["s1", "s2"] });
  const first = await artPreviewGenerationInput(input.storyId, 1, batch.id, 1);
  expect(first.prompt).toContain(direction.confirmed);
  expect(first.prompt).not.toMatch(/Lone skater|frame 1/);
  expect((await artPreviewGenerationInput(input.storyId, 1, batch.id, 2)).prompt).toContain("Lone skater.");
  await patch(input.storyId, { shotSceneDirections: [{ ...direction, confirmed: "Two sailors." }] });
  await expect(artPreviewGenerationInput(input.storyId, 1, batch.id, 1)).rejects.toThrow("重新查看");
});
async function patch(storyId: number, body: Record<string, unknown>) {
  const story = (await getStoryById(storyId, 1))!;
  await updateStory(storyId, 1, { body: { ...story.body as Record<string, unknown>, ...body } });
}
it("re-quotes one failed preview, reuses its request across windows and follows the new receipt", async () => {
  const input = await fixture();
  const plan = await planArtPreviews({ ...input, sampleShotIds: ["s1","s2"], adjustment: "warm" });
  const target = plan.shots[1];
  const task = { requestId: target.requestId, shotIdentity: `preview:${plan.id}:s2`, status: "failed", result: { status: "error", error: "sample failure" } };
  await patch(input.storyId, { storyboardImageTasks: [task] });
  const rows = () => warehouseImageAttempts(input.storyId, 1);
  expect(await rows()).toMatchObject([{ shotId: "s2", failureCount: 1, error: "sample failure", previewRetry: { failedId: target.requestId } }]);
  const basis = await readPreviewArtBasis(input.storyId, 1);
  const request = { ...input, basisKey: basis.basisKey, failedId: target.requestId };
  await expect(retryPreviewPlan({ ...request, userId: 2 })).rejects.toThrow();
  await expect(retryPreviewPlan({ ...request, basisKey: "outdated" })).rejects.toThrow("变化");
  const retry = await retryPreviewPlan(request);
  expect(retry.shots.map(s=>s.stableShotId)).toEqual(["s2"]);
  expect(retry).toMatchObject({retryOf: target.requestId, adjustment: "warm", estimatedCny: 0.68, baselineImageId: input.imageId});
  expect((await retryPreviewPlan(request)).shots[0].requestId).toBe(retry.shots[0].requestId);
  const child = { ...task, requestId: retry.shots[0].requestId, shotIdentity: `preview:${retry.id}:s2` };
  await patch(input.storyId, { storyboardImageTasks: [task, child] });
  expect(await rows()).toMatchObject([{requestId: child.requestId, requestIds: [child.requestId, task.requestId], failureCount: 2}]);
  await expect(retryPreviewPlan(request)).rejects.toThrow("变化");
  await patch(input.storyId, { storyboardImageTasks: [task, { ...child, status: "accepted" }] });
  expect(await rows()).toMatchObject([{status: "accepted", previewRetry: undefined}]);
  await patch(input.storyId, { storyboardImageTasks: [{ ...task, result: { ...task.result, submissionUncertain: true } }] });
  expect((await rows())[0].previewRetry).toBeUndefined();
  expect(mocks.agent).not.toHaveBeenCalled();
});

it("freezes the combined sample ceiling and only retries an already analyzed source at the warehouse price", async () => {
  const input = await fixture();
  const reading = await import("./shotSceneReading");
  const quote = vi.spyOn(reading, "quoteSceneReading");
  const allowance = { stableShotId: "s2", key: "a".repeat(64), estimatedCny: .032, imageId: 11 };
  quote.mockResolvedValue({ ...allowance, cached: false, pending: false, unfinished: false, authFailed: false, observed: undefined, layout: undefined });
  try {
    const request = { ...input, sampleShotIds: ["s1", "s2"], sceneAllowances: [allowance] };
    const batch = await planArtPreviews(request);
    expect(batch.estimatedCny).toBe(1.392);
    expect(batch.shots.map(s => s.sceneAllowance)).toEqual([undefined, allowance]);
    await expect(planArtPreviews({ ...request, sceneAllowances: [] })).rejects.toThrow("另一份分析报价");
    const target = batch.shots[1];
    await patch(input.storyId, { storyboardImageTasks: [{ requestId: target.requestId, shotIdentity: `preview:${batch.id}:s2`, status: "failed", result: { status: "error", error: "test" } }] });
    const basis = await readPreviewArtBasis(input.storyId, 1);
    const retry = { ...input, failedId: target.requestId, basisKey: basis.basisKey };
    await expect(retryPreviewPlan(retry)).rejects.toThrow("合计报价");
    const free = { ...allowance, key: "b".repeat(64), estimatedCny: 0 };
    quote.mockResolvedValue({ ...free, cached: true, pending: false, unfinished: false, authFailed: false, observed: "blue boat", layout: undefined });
    expect(await retryPreviewPlan(retry)).toMatchObject({ estimatedCny: .68, shots: [{ sceneAllowance: free }] });
    expect(mocks.agent).not.toHaveBeenCalled();
  } finally { quote.mockRestore(); }
});
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
it("quotes only the chosen tone samples, preserves their order in the film and does not submit images", async () => {
  const input = await fixture();
  await patch(input.storyId, { shots: [1,2,3].map(n => ({ stableShotId: `s${n}`, shotNo: n, promptDraft: `frame ${n}` })) });
  const selection = { ...input, sampleShotIds: ["s3", "s1"] };
  const batch = await planArtPreviews(selection);
  expect(batch.shots.map(shot => shot.shotNo)).toEqual([1, 3]);
  expect(batch.estimatedCny).toBe(1.36);
  expect(await planArtPreviews(selection)).toEqual(batch);
  await expect(planArtPreviews({ ...selection, sampleShotIds: ["s2"] })).rejects.toThrow("操作标识");
  await expect(planArtPreviews({ ...input, operationToken: crypto.randomUUID(), sampleShotIds: ["s1","missing"] })).rejects.toThrow("重新勾选");
  await expect(artPreviewGenerationInput(input.storyId, input.userId, batch.id, 2)).rejects.toThrow("未找到");
  expect((await readArtPreviews(input.storyId, input.userId))[0].shots.map(s => s.status)).toEqual(["planned","planned"]);
  expect(mocks.agent).not.toHaveBeenCalled();
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

it("plans one chosen shot without a reference or model call and rejects reuse for another shot", async () => {
  const input = { ...await fixture(), imageId: undefined, sampleShotId: "s2" };
  const batch = await planArtPreviews(input);
  expect(batch.baselineImageId).toBeNull();
  expect(batch.shots.map(s => s.stableShotId)).toEqual(["s2"]);
  expect(mocks.agent).not.toHaveBeenCalled();
  expect((await planArtPreviews(input)).id).toBe(batch.id);
  await expect(planArtPreviews({ ...input, sampleShotId: "s1" })).rejects.toThrow("操作标识");
});

const direction = (version: number, imageId: number) => ({
  recipe: { version, system: { name: "Ink", confirmedAt: 1, filmStyleImageId: imageId } },
});

it.each(["storage key", "warehouse URL"])("quotes the adopted manuscript's cover by %s and carries the art rules to the render", async source => {
  const input = await fixture();
  const key = source === "storage key" ? `chapters/1/${"a".repeat(64)}.jpg` : "generated/paper.png";
  const url = "/api/images/paper.png";
  const groupId = "publishing-group-v1-current";
  const manuscript = { id: "source", kind: "storyboard", number: 3, chapters: [{ blocks: { coverKey: source === "storage key" ? key : url } }] };
  const workflow = { schemaVersion: 1, revision: 3, current: { storyboard: "other" }, conversions: [], versions: [manuscript] };
  const shot = { stableShotId: "s1", shotNo: 1, promptDraft: "a monochrome brick wall", materialTexture: "rag paper", publishingVideo: { groupId } };
  await patch(input.storyId, {
    shots: [shot], bookWorkflow: workflow, artDirection: { recipe: { version: 4, style: ["charcoal"], palette: ["ochre"], system: { name: "Ink", confirmedAt: 1, filmStyleImageId: input.imageId } } },
    bookVideoRecords: [{ status: "adopted", versionId: "v1", videoVersion: 5, preview: { previewId: "current" }, manuscriptSource: { id: "source" }, brief: { tone: "quiet" } }],
  });
  mocks.material.mockResolvedValue({ shots: [], warehouseImages: [{ id: input.imageId, imageKey: key, imageUrl: url }], timeline: { extensions: {} } });
  const request = { ...input, imageId: undefined, sampleShotId: "s1", adjustment: "soften the ink shadow" };
  const batch = await planArtPreviews(request);
  expect(batch.artBasis).toMatchObject({ source: "test · 分镜稿 V3 · 视频 V5", coverImageId: input.imageId, styleName: "Ink V4" });
  expect(batch.baselineImageId).toBe(input.imageId);
  const result = await artPreviewGenerationInput(input.storyId, 1, batch.id, 1);
  for (const expected of ["charcoal","ochre","monochrome brick wall","rag paper","quiet",request.adjustment]) expect(result.prompt).toContain(expected);
  expect(result.renderReferences).toMatchObject({ imageIds: [input.imageId], filmStyleVersion: 4 });
  expect(mocks.agent).not.toHaveBeenCalled();
  await expect(planArtPreviews({ ...request, adjustment: "different change" })).rejects.toThrow("操作标识");
  await patch(input.storyId, { bookWorkflow: { ...workflow, versions: [{ ...manuscript, chapters: [{ blocks: {} }] }] } });
  await expect(artPreviewGenerationInput(input.storyId, 1, batch.id, 1)).rejects.toThrow("创作依据已变化");
});

it("inherits only adjustments from the adopted candidate, using it for the shot and retaining the separate film style", async () => {
  const input = await fixture();
  await patch(input.storyId, { artDirection: direction(4, input.imageId) });
  const first = await planArtPreviews({ ...input, sampleShotId: "s1", adjustment: "subtle ink lines" });
  await planArtPreviews({ ...input, operationToken: crypto.randomUUID(), sampleShotId: "s1", adjustment: "unselected experiment" });
  await patch(input.storyId, { storyboardImageTasks: [{ requestId: first.shots[0].requestId, status: "succeeded", result: { candidates: [{ imageId: 71, imageUrl: "/candidate.png" }] } }] });
  mocks.material.mockResolvedValue({ shots: [{ stableShotId: "s1", currentImage: { id: 71 }, imageVersions: [] }], timeline: { extensions: {} } });
  const next = await planArtPreviews({ ...input, imageId: undefined, operationToken: crypto.randomUUID(), sampleShotId: "s1", adjustment: "warm light" });
  const result = await artPreviewGenerationInput(input.storyId, 1, next.id, 1);
  expect(result.shot.previousChoice).toMatchObject({ imageId: 71, version: first.version });
  expect(result.renderReferences).toEqual({ imageIds: [71], assets: {}, filmStyleVersion: 4 });
  expect(result.prompt).toContain("subtle ink lines"); expect(result.prompt).toContain("warm light"); expect(result.prompt).not.toContain("unselected experiment");
});

it("requires a fresh quote after the first frame is adopted, then uses the selected frame and the film style", async () => {
  const input = await fixture();
  await patch(input.storyId, { artDirection: direction(4, input.imageId) });
  const request = { ...input, imageId: undefined, sampleShotId: "s1" };
  const first = await planArtPreviews(request);
  mocks.material.mockResolvedValue({ shots: [{ stableShotId: "s1", currentImage: { id: 71, selectionSource: "explicit" }, imageVersions: [] }], timeline: { extensions: {} } });
  expect((await artPreviewGenerationInput(input.storyId, 1, first.id, 1)).priorFrameChanged).toBe(true);
  const next = await planArtPreviews({ ...request, operationToken: crypto.randomUUID() });
  const result = await artPreviewGenerationInput(input.storyId, 1, next.id, 1);
  expect(result.priorFrameChanged).toBe(false);
  expect(result.renderReferences).toEqual({ imageIds: [71], assets: {}, filmStyleVersion: 4 });
  expect(result.prompt).not.toContain("比较这个镜头的四种画面");
});

it.each([{ sampleShotId: "s1" }, { sampleShotIds: ["s1", "s2"] }])("pins the style and baseline to the sample quote %j", async selection => {
  const input = await fixture();
  await patch(input.storyId, { artDirection: direction(4, input.imageId) });
  const batch = await planArtPreviews({ ...input, ...selection });
  for (const shot of batch.shots) {
    expect(await artPreviewGenerationInput(input.storyId, 1, batch.id, shot.shotNo)).toMatchObject({
      requiresNewStyleQuote: false, renderReferences: { imageIds: [input.imageId], filmStyleVersion: 4 },
    });
  }
  for (const artDirection of [direction(5, input.imageId), direction(4, input.imageId + 1)]) {
    await patch(input.storyId, { artDirection });
    await expect(artPreviewGenerationInput(input.storyId, 1, batch.id, 1)).rejects.toThrow("变化");
  }
});

it.each([false, true])("reads historical quotes and requires a fresh quote only with active style %s", async styled => {
  const input = await fixture();
  if (styled) await patch(input.storyId, { artDirection: direction(4, input.imageId) });
  const { filmStyle: _oldField, ...legacy } = await planArtPreviews({ ...input, sampleShotId: "s1" });
  await patch(input.storyId, { artPreviewBatches: [legacy] });
  expect((await artPreviewGenerationInput(input.storyId, 1, legacy.id, 1)).requiresNewStyleQuote).toBe(styled);
  expect(await readArtPreviews(input.storyId, 1)).toHaveLength(1);
});
