import { beforeEach, expect, it, vi } from "vitest";
import { createStory, createGeneratedImage, getStoryById, updateStory, resetMemoryStateForTesting } from "../db";
import { ENV } from "../_core/env";
import { writeArtSystem } from "./artSystemChat";
import { getStoryMaterialState } from "./storyMaterials";
import { activeArtSystemRecipe } from "../../shared/artSystem";
import { confirmedStoryboardImagePrompt } from "./confirmedStoryboardImagePrompt";
const mocks = vi.hoisted(() => ({ agent: vi.fn() }));
vi.mock("./agentRuntime", () => ({ runJsonAgent: mocks.agent }));
const draft = { name: "水墨体系", style: ["ink wash"], palette: ["indigo"], light: [], composition: ["open space"], material: ["paper"], negative: [], objectRules: ["teapot outline"], motionRules: ["slow flow"], continuityRules: ["keep brush grain"], englishPrompt: "Ink wash on fine paper with open negative space." };
beforeEach(() => { ENV.databaseUrl = ""; resetMemoryStateForTesting(); mocks.agent.mockReset().mockResolvedValue({ parsed: draft }); });
async function fixture(userId = 1) {
  const story = await createStory({ userId, title: "故事", body: { _revision: 1, shots: [{ stableShotId: "s1", shotNo: 1, promptDraft: "一把茶壶" }], messages: [{ role: "user", content: "想用水墨" }], customMarker: "keep" } });
  return { storyId: story.id, userId, editorName: "作者", operationToken: crypto.randomUUID(), instruction: "建立美术体系", action: "draft" as const, referenceImageIds: [], expectedVersion: 0 };
}
it("persists version, editor, intent and history; same request replays without another inference", async () => {
  const input = await fixture(); const result = await writeArtSystem(input);
  expect(result.version).toBe(1); expect(result.direction.phase).toBe("recipe-review");
  expect(result.direction.recipe?.system).toMatchObject({ editorId: 1, editorName: "作者", intent: input.instruction });
  expect(result.direction.recipe?.updatedAt).toBeGreaterThan(0);
  expect((await writeArtSystem(input)).replayed).toBe(true); expect(mocks.agent).toHaveBeenCalledTimes(1);
  await expect(writeArtSystem({ ...input, instruction: "另一要求" })).rejects.toThrow("操作标识");
  const saved = (await getStoryById(input.storyId, 1))!.body as Record<string, unknown>;
  expect(saved.customMarker).toBe("keep"); expect((saved.shots as unknown[]).length).toBe(1);
  expect(mocks.agent.mock.calls[0][0].history).toEqual([{ role: "user", content: "想用水墨" }]);
});
it("validates owner and every reference before inference or mutation", async () => {
  const input = await fixture(); const other = await fixture(2);
  const image = await createGeneratedImage({ storyId: other.storyId, userId: 2, imageUrl: "/foreign.png", prompt: "ref" });
  await expect(writeArtSystem({ ...input, userId: 2 })).rejects.toThrow("故事不存在");
  await expect(writeArtSystem({ ...input, referenceImageIds: [image.id] })).rejects.toThrow("不属于");
  await expect(writeArtSystem({ ...input, imageId: 999999 })).rejects.toThrow("不属于");
  expect(mocks.agent).not.toHaveBeenCalled();
});
it("confirms a baseline without changing image assignment and injects it into material/prompt projection", async () => {
  const input = await fixture(); await writeArtSystem(input);
  const image = await createGeneratedImage({ storyId: input.storyId, userId: 1, imageUrl: "https://example.test/teapot.png", prompt: "ref", isCurrent: false });
  const confirmation = await writeArtSystem({ ...input, action: "confirm", expectedVersion: 1, operationToken: crypto.randomUUID(), imageId: image.id });
  expect(confirmation.version).toBe(2); expect(confirmation.direction.phase).toBe("locked");
  expect(confirmation.direction.recipeVersions.map(r => r.version)).toEqual([1, 2]);
  const body = (await getStoryById(input.storyId, 1))!.body as Record<string, unknown>;
  expect(activeArtSystemRecipe(body)?.system?.confirmedImageId).toBe(image.id);
  const prompt = confirmedStoryboardImagePrompt({ body, shot: (body.shots as Record<string, unknown>[])[0], title: "故事" });
  expect(prompt).toContain("Ink wash"); expect(prompt).toContain("一把茶壶"); expect(prompt).toContain("V2");
  const material = await getStoryMaterialState(input.storyId, 1);
  expect(material?.artSystemReference?.image.id).toBe(image.id);
  expect(material?.shots[0].currentImage).toBeNull();
  const next = await writeArtSystem({ ...input, expectedVersion: 2, operationToken: crypto.randomUUID(), instruction: "美术体系调整色彩" });
  expect(next.direction.phase).toBe("recipe-review");
  expect(activeArtSystemRecipe({ artDirection: next.direction })?.version).toBe(2);
});
it("rejects confirmation of an unseen version and copying a foreign story; copies rules without media reassignment", async () => {
  const source = await fixture(); await writeArtSystem(source);
  await expect(writeArtSystem({ ...source, action: "confirm", operationToken: crypto.randomUUID(), expectedVersion: 0 })).rejects.toThrow("已更新");
  const target = await fixture();
  const copied = await writeArtSystem({ ...target, action: "copy", sourceStoryId: source.storyId });
  expect(copied.direction.recipe?.system).toMatchObject({ sourceStoryId: source.storyId, sourceVersion: 1, referenceImageIds: [] });
  expect(copied.direction.recipe?.system?.confirmedAt).toBeUndefined();
  const foreign = await fixture(2);
  await expect(writeArtSystem({ ...foreign, action: "copy", sourceStoryId: source.storyId })).rejects.toThrow("故事不存在");
});
it("does not overwrite a concurrent story edit or malformed model response", async () => {
  const input = await fixture();
  mocks.agent.mockImplementationOnce(async () => {
    const old = (await getStoryById(input.storyId, 1))!.body as Record<string, unknown>;
    await updateStory(input.storyId, 1, { body: { ...old, _revision: 2, customMarker: "concurrent" } });
    return { parsed: draft };
  });
  await expect(writeArtSystem(input)).resolves.toMatchObject({version:1,revision:3});
  const body = (await getStoryById(input.storyId, 1))!.body as Record<string, unknown>;
  expect(body.customMarker).toBe("concurrent"); expect(body.artDirection).toBeDefined();
  mocks.agent.mockResolvedValueOnce({ parsed: { name: "incomplete" } });
  await expect(writeArtSystem({...input,expectedVersion:1,operationToken:crypto.randomUUID()})).rejects.toThrow();
  expect(((await getStoryById(input.storyId, 1))!.body as Record<string, unknown>).artDirection).toEqual(body.artDirection);
});

it("restores the specifically named historical recipe as a new confirmed version", async () => {
  const input = await fixture(); await writeArtSystem(input);
  mocks.agent.mockResolvedValueOnce({ parsed: { ...draft, name: "Oil world", style: ["oil paint"] } });
  await writeArtSystem({ ...input, expectedVersion: 1, operationToken: crypto.randomUUID() });
  const restored = await writeArtSystem({ ...input, expectedVersion: 2, operationToken: crypto.randomUUID(), action: "confirm", recipeVersion: 1 });
  expect(restored.version).toBe(3); expect(restored.direction.recipe?.style).toEqual(["ink wash"]);
  expect(restored.direction.recipeVersions.find(r => r.version === 2)?.style).toEqual(["oil paint"]);
  await expect(writeArtSystem({ ...input, expectedVersion: 3, operationToken: crypto.randomUUID(), action: "confirm", recipeVersion: 999 })).rejects.toThrow("没有找到");
});

it("rebases unrelated chat saves after inference without calling the model twice", async () => {
  const input = await fixture();
  mocks.agent.mockImplementationOnce(async () => {
    const current = (await getStoryById(input.storyId, 1))!;
    await updateStory(input.storyId, 1, {body:{...(current.body as object), _revision:2, customMarker:"new chat saved", messages:[{role:"user",content:"new message"}]}});
    return {parsed:draft};
  });
  const saved = await writeArtSystem(input);
  expect(saved.version).toBe(1); expect(saved.revision).toBe(3); expect(mocks.agent).toHaveBeenCalledTimes(1);
  expect((await getStoryById(input.storyId,1))!.body).toMatchObject({customMarker:"new chat saved",messages:[{role:"user",content:"new message"}]});
});
it("does not overwrite a concurrent art edit after inference", async () => {
  const input = await fixture();
  mocks.agent.mockImplementationOnce(async () => {
    const current = (await getStoryById(input.storyId, 1))!;
    await updateStory(input.storyId, 1, {body:{...(current.body as object), _revision:2,artDirection:{phase:"recipe-review",recipe:{style:["other artist"],version:1,updatedAt:1},recipeVersions:[]}}});
    return {parsed:draft};
  });
  await expect(writeArtSystem(input)).rejects.toThrow("美术体系已更新");
  expect(mocks.agent).toHaveBeenCalledTimes(1);
});
