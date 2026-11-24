import { beforeEach, expect, it, vi } from "vitest";
import { createStory, resetMemoryStateForTesting } from "../db";
import { ENV } from "../_core/env";
import { analyzeShotScene, confirmShotScene, quoteSceneReading, sceneReadingBasis, readSceneForRender } from "./shotSceneReading";
import { prepareStoryBody } from "./storySync";
import { sceneLayoutText } from "../../shared/shotSceneDirection";

const mocks = vi.hoisted(() => ({ infer: vi.fn(), material: vi.fn(), pixels: vi.fn(), price: vi.fn(), locate: vi.fn(), bytes: vi.fn() }));
vi.mock("./localFrameRegions", () => ({ locateLocalObjects: mocks.locate, localObjectModelVersion: () => ["test-weights"] }));
vi.mock("./editingTransitionWorkflow", () => ({ imageBytesForAsset: mocks.bytes }));
vi.mock("../_core/inferenceOrchestrator", async old => ({ ...await old<object>(), runInference: mocks.infer }));
vi.mock("./storyMaterials", () => ({ getStoryMaterialState: mocks.material }));
vi.mock("./imageAssets", async old => ({ ...await old<object>(), materializeImageInput: mocks.pixels }));
vi.mock("./visualEditUnderstanding", () => ({ visualReadingCandidates: () => [{ id: "openai-next", model: "qwen3-vl-plus" }] }));
vi.mock("../_core/textComputeProvider", async old => ({ ...await old<object>(), resolveComputeCandidates: () => [{ id: "302", model: "gpt-4o" }] }));
vi.mock("../_core/inferenceBilling", async old => ({ ...await old<object>(), estimateInferenceMaxCostMinor: () => 32000 }));
vi.mock("../../shared/textComputePricing", async old => ({ ...await old<object>(), resolveTextPrice: mocks.price }));
const layout = { observed: "A crowd below.", people: [{ role: "dancer", count: "one", position: "balcony",
  clothing: "striped coat", action: "waves", target: "cyclist", gaze: "down" }], objects: [{ name: "bike", position: "below" }],
  omit: ["extras"], uncertain: ["shoe color"] };
beforeEach(() => { ENV.databaseUrl = ""; resetMemoryStateForTesting(); vi.clearAllMocks();
  mocks.price.mockReturnValue({ priced: true, yuanPer1kTokens: .02 });
  mocks.pixels.mockResolvedValue("data:image/png;base64,synthetic");
  mocks.infer.mockResolvedValue({ result: { choices: [{ message: { content: JSON.stringify(layout) } }] } });
});
async function fixture(userId = 5) {
  const story = await createStory({ userId, title: "Stage", body: { shots: [
    { stableShotId: "stage", shotNo: 1, action: "Look up", wardrobeReference: "striped coat" },
    { stableShotId: "other", shotNo: 2, action: "a dog at the lake" }] } });
  const image = { id: 11, userId, storyId: story.id, imageUrl: "/source.png", status: "pending" };
  mocks.material.mockResolvedValue({ shots: [{ stableShotId: "stage", imageVersions: [image] }, { stableShotId: "other", imageVersions: [] }],
    warehouseImages: [image, { ...image, id: 12 }] });
  return { storyId: story.id, stableShotId: "stage", userId };
}
it("reads only selected pixels, separates observation and uncertainty, and renders only after confirmation", async () => {
  const scope = await fixture();
  const req = { ...scope, imageId: 11, adjustment: "omit the extras" };
  const before = await sceneReadingBasis(scope);
  const quote = await quoteSceneReading(req);
  expect(mocks.infer).not.toHaveBeenCalled(); expect(mocks.pixels).not.toHaveBeenCalled();
  await expect(analyzeShotScene({ ...req, ...quote, estimatedCny: 0 })).rejects.toThrow("报价");
  await expect(quoteSceneReading({ ...req, imageId: 12 })).rejects.toThrow("不属于");
  await expect(quoteSceneReading({ ...req, userId: 9 })).rejects.toThrow();
  const read = await analyzeShotScene({ ...req, ...quote });
  expect(mocks.pixels).toHaveBeenCalledWith("/source.png", 5);
  const payload = JSON.stringify(mocks.infer.mock.calls[0][0].messages);
  expect(payload).toContain("data:image/png;base64,synthetic"); expect(payload).toContain("striped coat");
  expect(payload).not.toContain("a dog at the lake");
  expect((await sceneReadingBasis(scope)).confirmed).toBe("");
  const again = await quoteSceneReading(req); expect(again.estimatedCny).toBe(0);
  await analyzeShotScene({ ...req, ...again }); expect(mocks.infer).toHaveBeenCalledTimes(1);
  const text = sceneLayoutText(read);
  expect(text).not.toMatch(/A crowd below|shoe color/);
  await confirmShotScene({ ...scope, basisKey: before.basisKey, text });
  expect((await sceneReadingBasis(scope)).confirmed).toContain("balcony");
  await expect(confirmShotScene({ ...scope, basisKey: before.basisKey, text: "stale" })).rejects.toThrow("变化");
  expect((await sceneReadingBasis({ ...scope, stableShotId: "other" })).confirmed).toBe("");
});
it("uses a text request when there is no source image and never calls it an observation", async () => {
  const scope = await fixture();
  const quote = await quoteSceneReading(scope);
  const result = await analyzeShotScene({ ...scope, ...quote });
  expect(result.observed).toBe(""); expect(mocks.pixels).not.toHaveBeenCalled();
  expect(mocks.infer.mock.calls[0][0].useCase).toBe("text");
  expect(JSON.stringify(mocks.infer.mock.calls[0][0].messages)).not.toContain("image_url");
});
it("locates arbitrary objects once per source and retains direction across free reuse without inferring identities", async () => {
  const scope = await fixture();
  const local = { ...scope, imageId: 11, localTargets: ["violin", "cat"] };
  mocks.price.mockReturnValue({ priced: false });
  mocks.bytes.mockResolvedValue({ bytes: Buffer.from("first") });
  mocks.locate.mockResolvedValue([[[0, .7, .3, 1]], []]);
  const quote = await quoteSceneReading(local);
  expect(quote).toMatchObject({ cached: false, estimatedCny: 0 });
  await expect(quoteSceneReading({ ...local, userId: 999 })).rejects.toThrow();
  await expect(quoteSceneReading({ ...local, stableShotId: "other" })).rejects.toThrow();
  const [layout] = await Promise.all([analyzeShotScene({ ...local, ...quote }), analyzeShotScene({ ...local, ...quote })]);
  expect(layout).toMatchObject({ observed: "violin候选区域（左侧、下方）", people: [], uncertain: ["cat未能可靠定位"] });
  expect((await sceneReadingBasis(scope)).confirmed).toBe("");
  const changed = { ...local, adjustment: "raise the violin" };
  expect(await quoteSceneReading({ ...local, localTargets: ["cat", "violin"] })).toMatchObject({ cached: true, key: quote.key });
  const next = await quoteSceneReading(changed);
  expect(next).toMatchObject({ cached: true, estimatedCny: 0 });
  const prompt = await readSceneForRender(scope, { ...local, ...next }, changed.adjustment);
  expect(prompt).toContain("violin候选区域"); expect(prompt).toContain("striped coat"); expect(prompt).toContain(changed.adjustment);
  expect(prompt).not.toContain("cat"); expect(mocks.locate).toHaveBeenCalledTimes(1);
  await expect(readSceneForRender(scope, { ...local, ...quote, localTargets: ["dog"] })).rejects.toThrow("变化");
  mocks.bytes.mockResolvedValue({ bytes: Buffer.from("replaced in place") });
  await expect(analyzeShotScene({ ...local, ...quote })).rejects.toThrow("变化");
  mocks.locate.mockRejectedValueOnce(new Error("missing weights"));
  await expect(analyzeShotScene({ ...local, ...await quoteSceneReading(local) })).rejects.toThrow("手动");
  expect(mocks.infer).not.toHaveBeenCalled(); expect(mocks.price).not.toHaveBeenCalled();
});
it("gives different owners and projects independent zero-cost object readings even for identical bytes", async () => {
  mocks.bytes.mockResolvedValue({ bytes: Buffer.from("same image") });
  mocks.locate.mockResolvedValue([[]]);
  const keys = new Set(), scopes = new Set();
  for (const owner of [5, 5, 91]) {
    const scope = { ...await fixture(owner), imageId: 11, localTargets: ["telescope"] };
    const quote = await quoteSceneReading(scope);
    expect(quote).toMatchObject({ cached: false, estimatedCny: 0 });
    keys.add(quote.key);
    await analyzeShotScene({ ...scope, ...quote });
    scopes.add(mocks.locate.mock.lastCall?.[2]);
    expect((await quoteSceneReading(scope)).cached).toBe(true);
  }
  expect(keys.size).toBe(3); expect(scopes.size).toBe(3); expect(mocks.infer).not.toHaveBeenCalled();
});
it("keeps failed or malformed readings out of render inputs and rejects replay of a spent quote", async () => {
  const scope = await fixture(); const quote = await quoteSceneReading(scope);
  mocks.infer.mockResolvedValueOnce({ result: { choices: [] } });
  await expect(analyzeShotScene({ ...scope, ...quote })).rejects.toThrow("未完成");
  await expect(analyzeShotScene({ ...scope, ...quote })).rejects.toThrow("报价");
  expect(mocks.infer).toHaveBeenCalledTimes(1);
  expect((await sceneReadingBasis(scope)).confirmed).toBe("");
  expect(prepareStoryBody({ shotSceneDirections: ["forged"] }, 1, {})).not.toHaveProperty("shotSceneDirections");
});
it("routes text alone to the priced multimodal model if the text chain is unpriced", async () => {
  mocks.price.mockImplementation(({ model }) => ({ priced: model === "qwen3-vl-plus", yuanPer1kTokens: .02 }));
  const scope = await fixture();
  await analyzeShotScene({ ...scope, ...await quoteSceneReading(scope) });
  const request = mocks.infer.mock.calls[0][0];
  expect(request.explicitCandidates.map((c: { model: string }) => c.model)).toEqual(["qwen3-vl-plus"]);
  expect(request.messages[1].content).toEqual(expect.any(String));
  expect(mocks.pixels).not.toHaveBeenCalled();
});
it("allows only one inference for a quote used by two tabs", async () => {
  const scope = await fixture(); const quote = await quoteSceneReading(scope);
  const results = await Promise.allSettled([analyzeShotScene({ ...scope, ...quote }), analyzeShotScene({ ...scope, ...quote })]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(mocks.infer).toHaveBeenCalledTimes(1);
});
it("uses each source version once, including a re-opened image after a new direction or another source", async () => {
  const scope = await fixture();
  const source = { ...scope, imageId: 11 };
  const first = { ...source, ...await quoteSceneReading(source) };
  await expect(readSceneForRender(scope, first)).resolves.toContain("dancer");
  await expect(readSceneForRender(scope, first)).resolves.toContain("dancer");
  const revised = { ...source, adjustment: "one seated violinist" };
  const free = { ...revised, ...await quoteSceneReading(revised) };
  expect(free).toMatchObject({ estimatedCny: 0, cached: true, observed: layout.observed, layout: undefined });
  const prompt = await readSceneForRender(scope, free, revised.adjustment);
  expect(prompt).toContain("one seated violinist"); expect(prompt).toContain(layout.observed); expect(prompt).not.toContain("dancer");
  expect(await analyzeShotScene(free)).toMatchObject({ observed: layout.observed, people: [], uncertain: [] });
  const text = { ...scope, ...await quoteSceneReading(scope) };
  await readSceneForRender(scope, text);
  expect((await quoteSceneReading(source)).estimatedCny).toBe(0);
  expect(mocks.infer).toHaveBeenCalledTimes(2); expect(mocks.pixels).toHaveBeenCalledTimes(1);
  await expect(readSceneForRender({ ...scope, stableShotId: "other" }, first)).rejects.toThrow("镜头");
  const material = await mocks.material();
  material.warehouseImages[0].imageKey = "updated-pixels";
  await expect(readSceneForRender(scope, first)).rejects.toThrow("报价");
  const fresh = await quoteSceneReading(source);
  expect(fresh.estimatedCny).toBeGreaterThan(0);
  mocks.price.mockReturnValue({ priced: true, yuanPer1kTokens: .04 });
  await expect(readSceneForRender(scope, { ...source, ...fresh })).rejects.toThrow("报价");
  expect(mocks.infer).toHaveBeenCalledTimes(2);
});
