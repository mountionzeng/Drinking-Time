import { beforeEach, expect, it, vi } from "vitest";
import { createStory, resetMemoryStateForTesting } from "../db";
import { ENV } from "../_core/env";
import { analyzeShotScene, confirmShotScene, quoteSceneReading, sceneReadingBasis } from "./shotSceneReading";
import { prepareStoryBody } from "./storySync";
import { sceneLayoutText } from "../../shared/shotSceneDirection";

const mocks = vi.hoisted(() => ({ infer: vi.fn(), material: vi.fn(), pixels: vi.fn(), price: vi.fn() }));
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
async function fixture() {
  const story = await createStory({ userId: 5, title: "Stage", body: { shots: [
    { stableShotId: "stage", shotNo: 1, action: "Look up", wardrobeReference: "striped coat" },
    { stableShotId: "other", shotNo: 2, action: "a dog at the lake" }] } });
  const image = { id: 11, userId: 5, storyId: story.id, imageUrl: "/source.png", status: "pending" };
  mocks.material.mockResolvedValue({ shots: [{ stableShotId: "stage", imageVersions: [image] }, { stableShotId: "other", imageVersions: [] }],
    warehouseImages: [image, { ...image, id: 12 }] });
  return { storyId: story.id, stableShotId: "stage", userId: 5 };
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
