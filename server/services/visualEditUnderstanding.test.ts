import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ vision: vi.fn(), materialize: vi.fn() }));
vi.mock("../_core/inferenceOrchestrator", () => ({ runInference: m.vision }));
vi.mock("./imageAssets", () => ({ materializeImageInput: m.materialize }));
process.env.DATABASE_URL = "";
import { createStory, getStoryById, updateStoryBodyIfRevision } from "../repositories/stories";
import { createGeneratedImage, getGeneratedImageById } from "../repositories/images";
import { resetMemoryStateForTesting } from "../repositories/runtime";
import { quoteVisualEdit, preparedReferenceEditPrompt, inspectVisualEdit, visualReadingCandidates, manageVisualPreference, visualPreferences, visualEditPrompt, visualEditHistory, unwrapVisualReading, visualRetexturePrompt, RETEXTURE_KEEP_REST } from "./visualEditUnderstanding";
import { listPersonalMemoryInsightsForUser } from "./personalMemoryPersistence";
import { prepareStoryBody, mergeStaleStoryBody } from "./storySync";
let owner: { userId: number; storyId: number; stableShotId: string };
let imageId: number;
const reading = { observed: "高明度、低对比，浅粉蓝云朵与纸飞机", change: ["色彩更细腻"], preserve: ["明暗、灰度和构图"], uncertain: [], editPromptEnglish: "Refine only the requested color transitions. Preserve the original brightness, grayscale structure and composition." };
beforeEach(async () => {
  resetMemoryStateForTesting(); m.vision.mockReset(); m.materialize.mockReset();
  m.materialize.mockResolvedValue("data:image/png;base64,actualbytes");
  m.vision.mockResolvedValue({ model: "vision-test", result: { choices: [{ message: { content: JSON.stringify(reading) } }] } });
  const story = await createStory({ userId: 123, title: "visual", body: { shots: [{ stableShotId: "s1", shotNo: 1 }, { stableShotId: "s2", shotNo: 2 }], keep: "original" } });
  owner = { userId: 123, storyId: story.id, stableShotId: "s1" };
  imageId = (await createGeneratedImage({ ...owner, shotIdentity: "s1", imageKey: "source", imageUrl: "/source.png", isCurrent: true })).id;
});
it("sends actual owned image bytes, separates observations and preserves the source; deduplicates saved reads", async () => {
  const input = { ...owner, imageId, instruction: "只让色彩更细腻，明暗不变" };
  const first = await inspectVisualEdit(input);
  expect(first.brief).toMatchObject({ status: "seen", reading, instruction: input.instruction, editorUserId: 123 });
  expect(m.vision.mock.calls[0][0].messages[1].content[1]).toMatchObject({ type: "image_url", image_url: { url: "data:image/png;base64,actualbytes" } });
  expect((await inspectVisualEdit(input)).brief.id).toBe(first.brief.id);
  expect(m.vision).toHaveBeenCalledTimes(1);
  expect(await visualEditHistory({ ...owner, imageId })).toHaveLength(1);
  expect(await getGeneratedImageById(imageId)).toMatchObject({ isCurrent: true, imageUrl: "/source.png" });
  expect((await getStoryById(owner.storyId, 123))?.body).toMatchObject({ keep: "original" });
  expect(await listPersonalMemoryInsightsForUser({ userId: 123 })).toHaveLength(0);
});
it("rejects cross-account, story, shot and deleted image before calling vision", async () => {
  const input = { ...owner, imageId, instruction: "看图" };
  await expect(inspectVisualEdit({ ...input, userId: 124 })).rejects.toThrow();
  await expect(inspectVisualEdit({ ...input, stableShotId: "s2" })).rejects.toThrow();
  await expect(inspectVisualEdit({ ...input, imageId: 999 })).rejects.toThrow();
  const other = await createStory({ userId: 123, title: "other", body: {} });
  await expect(inspectVisualEdit({ ...input, storyId: other.id, stableShotId: undefined })).rejects.toThrow();
  expect(m.vision).not.toHaveBeenCalled();
});
it("records failure without pretending it saw the image and allows a later retry", async () => {
  m.vision.mockRejectedValueOnce(new Error("offline"));
  const input = { ...owner, imageId, instruction: "看图" };
  const fail = await inspectVisualEdit(input);
  expect(fail.brief).toMatchObject({ status: "unavailable", reading: null, model: null });
  expect(fail.reply).toContain("不会假装看过");
  expect((await inspectVisualEdit(input)).brief.status).toBe("seen");
  expect(await visualEditHistory(owner)).toHaveLength(1);
});
it("invalidates cached observations when explicit preferences change", async () => {
  const input = { ...owner, imageId, instruction: "看图" };
  const before = await inspectVisualEdit(input);
  await manageVisualPreference({ ...owner, action: "save", scope: "shot", text: "保留灰度" });
  const after = await inspectVisualEdit(input);
  expect(after.brief.id).not.toBe(before.brief.id);
  expect(m.vision).toHaveBeenCalledTimes(2);
});
it("stores explicit preferences with scope, revises them, forgets without deleting works, and keeps current instructions last", async () => {
  const save = { ...owner, action: "save" as const, scope: "story" as const, text: "喜欢柔和点彩，保留灰度" };
  await manageVisualPreference(save); await manageVisualPreference(save);
  expect(await visualPreferences(owner)).toHaveLength(1);
  await manageVisualPreference({ ...save, text: "这次作品偏冷色" });
  expect(await visualPreferences(owner)).toHaveLength(1);
  const all = await listPersonalMemoryInsightsForUser({ userId: 123 });
  expect(all).toHaveLength(2); expect(all.some(p => p.state === "superseded")).toBe(true);
  const prompt = await visualEditPrompt({ ...owner, instruction: "这次改成暖色" });
  expect(prompt).toContain("never override the current request");
  expect(prompt.endsWith("这次改成暖色")).toBe(true);
  await manageVisualPreference({ ...save, action: "forget" });
  expect(await visualPreferences(owner)).toHaveLength(0);
  expect((await visualEditPrompt({ ...owner, instruction: "原样" }))).not.toContain("偏冷色");
  expect(await getGeneratedImageById(imageId)).not.toBeNull();
});
it("does not leak shot/story settings across scopes or include unrelated personal memories", async () => {
  await manageVisualPreference({ ...owner, action: "save", scope: "user", text: "我的点彩" });
  await manageVisualPreference({ ...owner, action: "save", scope: "shot", text: "一镜保留布局" });
  expect((await visualPreferences({ ...owner, stableShotId: "s2" })).map(p => p.text)).toEqual(["我的点彩"]);
  const other = await createStory({ userId: 123, title: "other", body: {} });
  expect((await visualPreferences({ storyId: other.id, userId: 123 })).map(p => p.text)).toEqual(["我的点彩"]);
  await expect(visualPreferences({ ...owner, userId: 999 })).rejects.toThrow();
});
it("learns only from explicit durable decisions; candidates and isCurrent are not evidence of preference", async () => {
  const story = (await getStoryById(owner.storyId, 123))!;
  await updateStoryBodyIfRevision({ id: owner.storyId, userId: 123, expectedRevision: 0, body: { ...story.body as object, _revision: 1, storyboardImageTasks: [
    { shotIdentity: "s1", meta: { instruction: "bad candidate" } },
    { shotIdentity: "s1", meta: { instruction: "more fine color" }, decision: { kind: "kept", userId: 123 } },
    { shotIdentity: "s2", meta: { instruction: "other shot" }, decision: { kind: "replaced", userId: 123 } },
  ] } });
  await inspectVisualEdit({ ...owner, imageId, instruction: "看图" });
  const context = JSON.parse(m.vision.mock.calls[0][0].messages[1].content[0].text);
  expect(context.explicitShotFeedback).toEqual([{ instruction: "more fine color", decision: "kept" }]);
  expect(await visualPreferences(owner)).toHaveLength(0);
});
it("autosave cannot erase or forge visual edit briefs", () => {
  const server = { shots: [], visualEditBriefs: [{ id: "saved" }] };
  expect(prepareStoryBody({ shots: [], visualEditBriefs: [] }, 2, server)).toMatchObject(server);
  expect(mergeStaleStoryBody(server, { shots: [], visualEditBriefs: [] }, 2)).toMatchObject(server);
  expect(prepareStoryBody(server, 1, { shots: [] })).not.toHaveProperty("visualEditBriefs");
});
it("coalesces simultaneous reads and reuses only a matching request's preservation notes", async () => {
  const input = { ...owner, imageId, instruction: "色彩更细腻" };
  const pair = await Promise.all([inspectVisualEdit(input), inspectVisualEdit(input)]);
  expect(pair[0].brief.id).toBe(pair[1].brief.id);
  expect(m.vision).toHaveBeenCalledTimes(1);
  const matched = await visualEditPrompt({ ...input, instruction: "用户修改要求：\n色彩更细腻" });
  expect(matched).toContain("明暗、灰度和构图");
  const different = await visualEditPrompt({ ...input, instruction: "重新调整构图" });
  expect(different).not.toContain("明暗、灰度和构图");
});

it("routes only explicitly authorized account/story/image scopes to 302", async () => {
  const { ENV } = await import("../_core/env");
  const saved = { next: ENV.openaiNextApiKey, api: ENV.api302Key, model: ENV.vision302Model, scopes: process.env.VISUAL_READING_302_IMAGE_SCOPES };
  try {
    ENV.openaiNextApiKey = "test-next"; ENV.api302Key = "test-302"; ENV.vision302Model = "gemini-2.5-flash";
    process.env.VISUAL_READING_302_IMAGE_SCOPES = "48:1217:2045,48:1217:2046,48:1217:2047";
    expect(visualReadingCandidates({userId:48,storyId:1217,imageId:2045})[0]?.id).toBe("302");
    expect(visualReadingCandidates({userId:49,storyId:1217,imageId:2045})[0]?.id).toBe("openai-next");
    expect(visualReadingCandidates({userId:48,storyId:1218,imageId:2045})[0]?.id).toBe("openai-next");
    expect(visualReadingCandidates({userId:48,storyId:1217,imageId:2050})[0]?.id).toBe("openai-next");
  } finally {
    ENV.openaiNextApiKey = saved.next; ENV.api302Key = saved.api; ENV.vision302Model = saved.model;
    if (saved.scopes == null) delete process.env.VISUAL_READING_302_IMAGE_SCOPES;
    else process.env.VISUAL_READING_302_IMAGE_SCOPES = saved.scopes;
  }
});

it("accepts a brief wrapped in one extra object and records only field paths when the shape is wrong", async () => {
  expect(unwrapVisualReading({ brief: reading })).toEqual(reading);
  expect(unwrapVisualReading(reading)).toBe(reading);
  expect(unwrapVisualReading({ a: reading, b: reading })).toEqual({ a: reading, b: reading });
  m.vision.mockResolvedValueOnce({ model: "vision-test", result: { choices: [{ message: { content: JSON.stringify({ brief: { observed: "纸飞机" } }) } }] } });
  expect((await inspectVisualEdit({ ...owner, imageId, instruction: "包了一层" })).brief).toMatchObject({ status: "seen", reading: { observed: "纸飞机", change: [], preserve: [], uncertain: [] } });
  m.vision.mockResolvedValueOnce({ model: "vision-test", result: { choices: [{ message: { content: JSON.stringify({ observed: "x", change: "SECRET-MODEL-TEXT" }) } }] } });
  const failed = (await inspectVisualEdit({ ...owner, imageId, instruction: "字段错误" })).brief;
  expect(failed.status).toBe("unavailable");
  expect(failed.failure).toMatch(/ZodError:.*change:invalid_type/);
  expect(failed.failure).not.toContain("SECRET-MODEL-TEXT");
});
it("builds a one-line Retexture prompt from the user's own words plus the fixed keep-the-rest sentence", () => {
  const own = "修改这张图片：只让色彩过渡更细腻。\n严格保留明暗。";
  const prompt = visualRetexturePrompt(`以所选参考图片为基础生成新版，保留未要求修改的主体与画面内容。用户修改要求：\n${own}`);
  expect(prompt).toBe(`修改这张图片：只让色彩过渡更细腻。 严格保留明暗。 ${RETEXTURE_KEEP_REST}`);
  expect(prompt).not.toMatch(/\n|以所选参考图片为基础|--v/);
  expect(visualRetexturePrompt("只改颜色")).toBe(`只改颜色 ${RETEXTURE_KEEP_REST}`);
  expect(RETEXTURE_KEEP_REST).toMatch(/^[\x20-\x7E]+$/);
  const english = visualRetexturePrompt("以所选参考图片为基础生成新版，保留未要求修改的主体与画面内容。用户修改要求：\nRefine this image only: smoother color transitions.");
  expect(english).toBe(`Refine this image only: smoother color transitions. ${RETEXTURE_KEEP_REST}`);
  expect(english).toMatch(/^[\x20-\x7E]+$/);
});

it("quotes without reading bytes or invoking a model, and binds cached quotes to preferences", async () => {
  const input = {...owner,imageId,instruction:"更细腻"};
  const quote = await quoteVisualEdit(input);
  expect(Number.isFinite(quote.estimatedCny)).toBe(true);
  expect(m.vision).not.toHaveBeenCalled(); expect(m.materialize).not.toHaveBeenCalled();
  await inspectVisualEdit(input);
  expect(await quoteVisualEdit(input)).toMatchObject({cached:true,estimatedCny:0,fingerprint:quote.fingerprint});
  await manageVisualPreference({...owner,action:"save",scope:"shot",text:"不要改明暗"});
  expect((await quoteVisualEdit(input)).fingerprint).not.toBe(quote.fingerprint);
});
it("reuses a compiled reading when only the MJ supplier changes, retaining the new request and quote identity", async () => {
  const input = { ...owner, imageId, language: "zh", instruction: "修改第03镜图片 #2046，使用302 MJ原图编辑，只让颜色更细腻，明暗不变。" };
  const original = await inspectVisualEdit(input);
  const switched = { ...input, instruction: input.instruction.replace("使用302 MJ", "使用Legnext MJ") };
  const before = await quoteVisualEdit(input);
  const quote = await quoteVisualEdit(switched);
  expect(quote).toMatchObject({ cached: true, estimatedCny: 0 });
  expect(quote.fingerprint).not.toBe(before.fingerprint);
  const reused = await inspectVisualEdit(switched);
  expect(reused.brief).toMatchObject({ instruction: switched.instruction, reusedFromBriefId: original.brief.id, reading });
  expect(reused.brief.id).toBe(quote.fingerprint);
  expect(m.vision).toHaveBeenCalledTimes(1);
  expect(m.materialize).toHaveBeenCalledTimes(1);
  expect(await preparedReferenceEditPrompt(switched)).toContain(reading.editPromptEnglish);
  expect(await visualEditHistory(owner)).toHaveLength(2);
  expect((await inspectVisualEdit(input)).brief).toEqual(original.brief);
  expect((await quoteVisualEdit({ ...switched, instruction: switched.instruction.replace("明暗不变", "把画面提亮") })).cached).toBe(false);
  expect((await quoteVisualEdit({ ...switched, language: "en" })).cached).toBe(false);
  await manageVisualPreference({ ...owner, action: "save", scope: "shot", text: "保持原有颗粒大小" });
  expect((await quoteVisualEdit(switched)).cached).toBe(false);
});
it.each([
  ["使用302 MJ原图编辑，颜色更细腻。", "使用Legnext MJ原图编辑，颜色更细腻。"],
  ["Use 302 MJ Edits. Refine colors only.", "Use Legnext MJ Retexture. Refine colors only."],
  ["修改第03镜图片 #2046，使用302 MJ原图编辑，颜色更细腻。", "修改第03镜图片 #2046，使用302 GPT Image 2原图编辑，颜色更细腻。"],
  ["Use Legnext MJ Retexture. Refine colors only.", "Use 302 GPT Image 2 Edits. Refine colors only."],
  ["修改第03镜图片 #2046，使用302 MJ原图编辑，颜色更细腻。", "修改第03镜图片 #2046，使用302 FLUX Kontext Pro原图编辑，颜色更细腻。"],
  ["Use 302 GPT Image 2 Edits. Refine colors only.", "Use 302 FLUX Kontext Pro Edits. Refine colors only."],
])("reuses only a complete leading supplier clause: %s", async (instruction, switched) => {
  await inspectVisualEdit({ ...owner, imageId, instruction });
  expect(await quoteVisualEdit({ ...owner, imageId, instruction: switched })).toMatchObject({ cached: true, estimatedCny: 0 });
});
it.each([
  "把招牌文字改成“使用302 MJ原图编辑，颜色更细腻”。",
  "使用302 MJ原图编辑风格，颜色更细腻。",
  "不要使用302 MJ原图编辑，颜色更细腻。",
])("does not erase quoted, visual or negative instructions: %s", async instruction => {
  await inspectVisualEdit({ ...owner, imageId, instruction });
  expect((await quoteVisualEdit({ ...owner, imageId, instruction: instruction.replace("302", "Legnext") })).cached).toBe(false);
});
it("does not treat an unknown model version as an equivalent editing route", async () => {
  await inspectVisualEdit({ ...owner, imageId, instruction: "使用302 MJ原图编辑，颜色更细腻。" });
  expect((await quoteVisualEdit({ ...owner, imageId, instruction: "使用302 GPT Image 3原图编辑，颜色更细腻。" })).cached).toBe(false);
});
it("reuses only the matching owned reading translation and never invents a missing translation", async () => {
  const input = {...owner,imageId,instruction:"森林树种更多，其他不变"};
  await expect(preparedReferenceEditPrompt(input)).rejects.toThrow("尚未提交 MJ");
  m.vision.mockResolvedValueOnce({model:"test",result:{choices:[{message:{content:JSON.stringify({...reading,editPromptEnglish:"More tree varieties; preserve everything else."})}}]}});
  await inspectVisualEdit(input);
  expect(await preparedReferenceEditPrompt(input)).toContain("More tree varieties");
  expect(m.vision).toHaveBeenCalledTimes(1);
  expect(m.vision.mock.calls[0][0]).toMatchObject({maxAttempts:1,replaySafe:false});
  await expect(preparedReferenceEditPrompt({...input,instruction:"改变光线"})).rejects.toThrow();
});

it("uses the existing art director with the confirmed art system and invalidates old briefs when art changes", async()=>{
 const input={...owner,imageId,instruction:"树木的颜色更细腻，其他不变"};
 const before=await quoteVisualEdit(input);
 const story=(await getStoryById(owner.storyId,owner.userId))!;
 const body=story.body as Record<string,unknown>;
 const recipe={version:1,updatedAt:1,sourceCandidateIds:[],style:["pointillism"],palette:[],light:[],composition:[],material:[],negative:[],system:{name:"微彩",englishPrompt:"Delicate colorful stippled surfaces.",objectRules:[],motionRules:[],continuityRules:[],referenceImageIds:[imageId],confirmedAt:1}};
 await updateStoryBodyIfRevision({id:owner.storyId,userId:owner.userId,expectedRevision:0,body:{...body,_revision:1,artDirection:{recipe,recipeVersions:[recipe]}}});
 expect((await quoteVisualEdit(input)).fingerprint).not.toBe(before.fingerprint);
 await inspectVisualEdit(input);
 const request=m.vision.mock.calls[0][0];
 expect(request.messages[0].content).toContain("constrained-edit mode");
 const context=JSON.parse(request.messages[1].content[0].text);
 expect(context.confirmedArtSystem).toContain("Delicate colorful stippled surfaces.");
 expect(context.currentRequest).toBe(input.instruction);
 expect(request.messages[0].content).toContain("Current user words override");
});

it("does not cache a missing edit compilation as a free successful retry", async () => {
 const input={...owner,imageId,instruction:"树种更多"};
 m.vision.mockResolvedValueOnce({model:"test",result:{choices:[{message:{content:JSON.stringify({...reading,editPromptEnglish:undefined})}}]}});
 await inspectVisualEdit(input);
 expect((await quoteVisualEdit(input)).cached).toBe(false);
 await inspectVisualEdit(input);expect(m.vision).toHaveBeenCalledTimes(2);
});
it("requires clarification instead of submitting an uncertain interpretation", async () => {
 const input={...owner,imageId,instruction:"把这个改一下"};
 m.vision.mockResolvedValueOnce({model:"test",result:{choices:[{message:{content:JSON.stringify({...reading,uncertain:["要改哪个部分？"]})}}]}});
 await inspectVisualEdit(input);
 await expect(preparedReferenceEditPrompt(input)).rejects.toThrow("请先澄清");
});
