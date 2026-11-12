import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const spies = vi.hoisted(() => ({
  generateImage: vi.fn(), editImage: vi.fn(), runImageRenderProfile: vi.fn(),
  reserveForOperation: vi.fn(), settleOperation: vi.fn(), reserveMedia: vi.fn(), recordMediaResult: vi.fn(),
  runInference: vi.fn(), generateLegnextImage: vi.fn(),
}));
vi.mock("./imageGen", async importOriginal => ({ ...(await importOriginal<typeof import("./imageGen")>()), generateImage: spies.generateImage, editImage: spies.editImage, runImageRenderProfile: spies.runImageRenderProfile }));
vi.mock("./legnextImage", async importOriginal => ({ ...(await importOriginal<typeof import("./legnextImage")>()), generateLegnextImage: spies.generateLegnextImage }));
vi.mock("./computeLedger", async importOriginal => ({ ...(await importOriginal<typeof import("./computeLedger")>()), reserveForOperation: spies.reserveForOperation, settleOperation: spies.settleOperation }));
vi.mock("./mediaComputeBilling", async importOriginal => ({ ...(await importOriginal<typeof import("./mediaComputeBilling")>()), reserveMedia: spies.reserveMedia, recordMediaResult: spies.recordMediaResult }));
// 存图后的异地备份（storagePut）是所有新图都有的既有行为，不是供应商生成；这里替换掉，测试里不发网络。
const storage = vi.hoisted(() => ({ storagePut: vi.fn(async (key: string) => ({ key, url: `/backup/${key}` })) }));
vi.mock("../storage", async importOriginal => ({ ...(await importOriginal<typeof import("../storage")>()), storagePut: storage.storagePut }));
vi.mock("../_core/inferenceOrchestrator", async importOriginal => ({ ...(await importOriginal<typeof import("../_core/inferenceOrchestrator")>()), runInference: spies.runInference }));

process.env.DATABASE_URL = "";
const { createStory, getStoryById, updateStory } = await import("../repositories/stories");
const { createGeneratedImage, getStoryGeneratedImages } = await import("../repositories/images");
const { resetMemoryStateForTesting } = await import("../repositories/runtime");
const { transferStoryImageColor, gradeStoryImageLuminance } = await import("./chatColorTransfer");
const { readChatImageRevisions, decideChatImageRevision } = await import("./chatImageRevision");

const W = 48, H = 48;
async function dataUrl(rgb: (x: number, y: number) => [number, number, number]) {
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) raw.set(rgb(x, y), (y * W + x) * 3);
  const png = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

let storyId: number;
const userId = 77;
let ids: { source: number; t1: number; t2: number; loose: number };
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  resetMemoryStateForTesting();
  Object.values(spies).forEach(spy => spy.mockReset());
  fetchSpy = vi.fn(async () => { throw new Error("network disabled in test"); });
  vi.stubGlobal("fetch", fetchSpy);
  const story = await createStory({
    userId, title: "color",
    body: { shots: [{ shotNo: 1, stableShotId: "s1" }, { shotNo: 2, stableShotId: "s2" }, { shotNo: 3, stableShotId: "s3" }] },
  });
  storyId = story.id;
  const warm = await dataUrl((x, y) => [210 + (x % 40), 160 + (y % 40), 130]);
  const green = await dataUrl((x, y) => [70 + x, 120 + y, 80 + (x % 20)]);
  const make = (shot: number | null, imageUrl: string) => createGeneratedImage({
    storyId, userId, projectId: null, imageUrl, imageKey: null, prompt: "seed", isCurrent: true,
    ...(shot ? { shotNo: `SH0${shot}`, shotIdentity: `s${shot}` } : { shotNo: null, shotIdentity: null }),
  });
  ids = { source: (await make(1, warm)).id, t1: (await make(2, green)).id, t2: (await make(3, green)).id, loose: (await make(null, green)).id };
});
afterEach(() => vi.unstubAllGlobals());

describe("transferStoryImageColor (image.local-color-transfer)", () => {
  it("makes new versions for every target, keeps originals, records 替换/保留 candidates, spends nothing", async () => {
    const result = await transferStoryImageColor({
      storyId, userId, requestId: "req-00000001", instruction: "按照图一的颜色改图二图三",
      source: { imageId: ids.source }, targets: [{ imageId: ids.t1 }, { shotNo: 3 }, { imageId: ids.loose }],
    });
    expect(result.sourceImageId).toBe(ids.source);
    expect(result.results.map(r => r.status)).toEqual(["ok", "ok", "ok"]);
    const ok = result.results.filter(r => r.status === "ok") as Extract<(typeof result.results)[number], { status: "ok" }>[];
    expect(ok.map(r => r.targetImageId)).toEqual([ids.t1, ids.t2, ids.loose]);
    expect(ok.map(r => r.awaitingDecision)).toEqual([true, true, false]);
    expect(ok.map(r => r.shotNo)).toEqual([2, 3, null]);

    const images = await getStoryGeneratedImages(storyId, userId);
    for (const r of ok) {
      const created = images.find(image => image.id === r.imageId)!;
      expect(created.parentImageId).toBe(r.targetImageId);
      expect(created.isCurrent).toBe(false);
      const original = images.find(image => image.id === r.targetImageId)!;
      expect(original.isCurrent).toBe(true);
      expect(original.imageUrl.startsWith("data:image/png")).toBe(true);
    }

    const revisions = await readChatImageRevisions(storyId, userId);
    const pending = revisions.filter(r => r.requestId.startsWith("color:") && !r.decision);
    expect(pending.map(r => [r.shotNo, r.sourceImageId, r.candidates[0].imageId])).toEqual([[2, ids.t1, ok[0].imageId], [3, ids.t2, ok[1].imageId]]);

    // 保留原图：沿用现有的 decideChatImageRevision，不改它
    await decideChatImageRevision({ storyId, userId, requestId: pending[0].requestId, kind: "keep" });
    expect((await readChatImageRevisions(storyId, userId)).find(r => r.requestId === pending[0].requestId)?.decision?.kind).toBe("kept");

    // 0 元：没有读图、没有供应商请求、没有预占/结算、没有网络
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    const body = (await getStoryById(storyId, userId))!.body as { storyboardImageTasks: Array<{ meta: { localGrade: { profile: string; computeUnits: number; costCny: number } } }> };
    expect(body.storyboardImageTasks.every(task => task.meta.localGrade.profile === "image.local-color-transfer" && task.meta.localGrade.computeUnits === 0 && task.meta.localGrade.costCny === 0)).toBe(true);
  });

  it("replaying the same requestId returns the same images without recomputing", async () => {
    const request = { storyId, userId, requestId: "req-00000002", instruction: "x", source: { imageId: ids.source }, targets: [{ imageId: ids.t1 }] };
    const first = await transferStoryImageColor(request);
    const count = (await getStoryGeneratedImages(storyId, userId)).length;
    const second = await transferStoryImageColor(request);
    expect(second).toEqual(first);
    expect((await getStoryGeneratedImages(storyId, userId)).length).toBe(count);
    const body = (await getStoryById(storyId, userId))!.body as { storyboardImageTasks: unknown[] };
    expect(body.storyboardImageTasks).toHaveLength(1);
  });

  it("reports per-target problems and still finishes the others", async () => {
    const result = await transferStoryImageColor({
      storyId, userId, requestId: "req-00000003", instruction: "x",
      source: { imageId: ids.source }, targets: [{ imageId: 999999 }, { imageId: ids.source }, { shotNo: 9 }, { imageId: ids.t1 }],
    });
    expect(result.results.map(r => r.status)).toEqual(["error", "error", "error", "ok"]);
    expect(result.results[0]).toMatchObject({ error: expect.stringMatching(/不在当前故事/) });
    expect(result.results[1]).toMatchObject({ error: "和参考图是同一张" });
    expect(result.results[2]).toMatchObject({ error: expect.stringMatching(/没有第 9 镜/) });
  });

  it("refuses another user's story and an unknown source", async () => {
    await expect(transferStoryImageColor({ storyId, userId: 999, requestId: "req-00000004", instruction: "x", source: { imageId: ids.source }, targets: [{ imageId: ids.t1 }] })).rejects.toThrow(/无权/);
    await expect(transferStoryImageColor({ storyId, userId, requestId: "req-00000005", instruction: "x", source: { imageId: 424242 }, targets: [{ imageId: ids.t1 }] })).rejects.toThrow(/没有调色/);
  });

  describe("gradeStoryImageLuminance (只调亮度)", () => {
    it("makes mid/full candidates in one revision, keeps hue/S, keeps the original, spends nothing", async () => {
      const result = await gradeStoryImageLuminance({
        storyId, userId, requestId: "luma-0000001", instruction: "按图片 #1 的亮度调图二",
        reference: { imageId: ids.source }, targets: [{ imageId: ids.t1 }, { imageId: ids.loose }], strengths: ["mid", "full"],
      });
      expect(result.results.map(r => r.status)).toEqual(["ok", "ok"]);
      const first = result.results[0] as Extract<(typeof result.results)[number], { status: "ok" }>;
      expect(first.candidates.map(c => c.strength)).toEqual(["mid", "full"]);
      expect(first.awaitingDecision).toBe(true);
      expect(result.results[1]).toMatchObject({ awaitingDecision: false });
      for (const c of first.candidates) {
        expect(c.metrics!.lMeanAfter).toBeGreaterThan(c.metrics!.lMeanBefore);
        expect(c.metrics!.hueP95Deg).toBeLessThanOrEqual(4);
      }
      const images = await getStoryGeneratedImages(storyId, userId);
      expect(images.find(i => i.id === ids.t1)!.isCurrent).toBe(true);
      for (const c of first.candidates) expect(images.find(i => i.id === c.imageId)).toMatchObject({ parentImageId: ids.t1, isCurrent: false });
      const revision = (await readChatImageRevisions(storyId, userId)).find(r => r.requestId === `luma:luma-0000001:${ids.t1}`)!;
      expect(revision.candidates.map(c => c.imageId)).toEqual(first.candidates.map(c => c.imageId));
      expect(revision.decision).toBeUndefined();
      for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      // 「保留原图」沿用现有决策流程（「替换原图」需要剪辑线，属于现有 decideChatImageRevision 的测试范围）
      await decideChatImageRevision({ storyId, userId, requestId: revision.requestId, kind: "keep" });
      expect((await readChatImageRevisions(storyId, userId)).find(r => r.requestId === revision.requestId)?.decision?.kind).toBe("kept");
    });

    it("defaults the reference to the shot's first frame, and replays without recomputing", async () => {
      const story = (await getStoryById(storyId, userId))!;
      const body = story.body as { shots: Array<Record<string, unknown>> };
      body.shots[1] = { ...body.shots[1], generationParams: { frameMode: "start_end", firstFrameImageId: ids.source } };
      await updateStory(storyId, userId, { body });
      const request = { storyId, userId, requestId: "luma-0000002", instruction: "图二只调亮度", targets: [{ imageId: ids.t1 }], strengths: ["mid" as const] };
      const first = await gradeStoryImageLuminance(request);
      expect(first.results[0]).toMatchObject({ status: "ok", referenceImageId: ids.source });
      const count = (await getStoryGeneratedImages(storyId, userId)).length;
      const again = await gradeStoryImageLuminance(request);
      expect(again.results[0]).toMatchObject({ status: "ok", candidates: [{ imageId: (first.results[0] as { candidates: Array<{ imageId: number }> }).candidates[0].imageId }] });
      expect((await getStoryGeneratedImages(storyId, userId)).length).toBe(count);
    });

    it("reports a target without any reference instead of guessing", async () => {
      const result = await gradeStoryImageLuminance({ storyId, userId, requestId: "luma-0000003", instruction: "只调亮度", targets: [{ imageId: ids.t2 }], strengths: ["mid"] });
      expect(result.results[0]).toMatchObject({ status: "error", error: expect.stringMatching(/没有指定亮度参考图/) });
    });
  });
});
