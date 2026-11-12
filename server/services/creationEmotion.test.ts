import { beforeEach, describe, expect, it } from "vitest";
import { createStory, getStoryById, resetMemoryStateForTesting } from "../db";
import {
  getCreationEmotion,
  saveCreationEmotion,
  handleCreationEmotionChat,
  storyEmotion,
  getCreationEmotionUsage,
} from "./creationEmotion";
import { prepareStoryBody } from "./storySync";
import { compileCreationEmotion } from "../../shared/creationEmotion";
beforeEach(() => resetMemoryStateForTesting());
async function seed() {
  const story = await createStory({
    userId: 71,
    title: "工作情绪测试",
    body: {
      _revision: 0,
      shots: [{ stableShotId: "cup", shotNo: 1, subject: "小茶杯" }],
      personalEmotionProfile: { emotion: "愤怒" },
    },
  });
  return { storyId: story.id, userId: 71 };
}
describe("persisted work intent and conversation", () => {
  it("persists immutable revisions across reload, prevents stale autosave and rejects foreign access", async () => {
    const owner = await seed();
    const first = await saveCreationEmotion({
      ...owner,
      expectedRevision: 0,
      scope: { kind: "story" },
      intent: { raw: "温暖怀念" },
    });
    const second = await saveCreationEmotion({
      ...owner,
      expectedRevision: 1,
      scope: { kind: "shot", id: "cup" },
      intent: { raw: "释然平静", mediumDirections: { music: "轻快反衬" } },
    });
    expect(await getCreationEmotion(owner)).toEqual(second);
    expect(second.history[0]).toEqual(first.history[0]);
    const persisted = await getStoryById(owner.storyId, owner.userId);
    expect(
      prepareStoryBody({ creationEmotion: first }, 10, persisted!.body)
        .creationEmotion
    ).toEqual(second);
    expect(
      prepareStoryBody({ creationEmotion: first }, 1, {}).creationEmotion
    ).toBeUndefined();
    await expect(
      saveCreationEmotion({
        ...owner,
        expectedRevision: 1,
        scope: { kind: "story" },
        intent: { raw: "错误覆盖" },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      getCreationEmotion({ ...owner, userId: 72 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const prompt = compileCreationEmotion(
      storyEmotion(persisted!.body, { shotId: "cup" }),
      "music"
    );
    expect(prompt).toContain("轻快反衬");
    expect(prompt).not.toContain("愤怒");
  });
  it("commits explicit work intent locally, never turns personal feelings into a work setting", async () => {
    const owner = await seed();
    expect(
      await handleCreationEmotionChat({ ...owner, message: "我今天很失落" })
    ).toBeNull();
    expect((await getCreationEmotion(owner)).revision).toBe(0);
    const reply = await handleCreationEmotionChat({
      ...owner,
      message: "把作品情绪设为：有一点失落，但并不绝望，最后慢慢释怀。",
    });
    expect(reply?.reply).toContain("并不绝望");
    expect(reply?.toolCalls).toEqual([]);
    const show = await handleCreationEmotionChat({
      ...owner,
      message: "查看作品情绪历史",
    });
    expect(show?.reply).toContain("修订记录");
    expect((await getCreationEmotion(owner)).revision).toBe(1);
    await handleCreationEmotionChat({
      ...owner,
      message: "把作品情绪设为：有一点失落，但并不绝望，最后慢慢释怀。",
    });
    expect((await getCreationEmotion(owner)).revision).toBe(1);
    const shotReply = await handleCreationEmotionChat({
      ...owner,
      message: "把第01镜情绪改为：压抑不安",
    });
    expect(shotReply?.reply).toContain("第01镜情绪 E2");
    expect((await getCreationEmotion(owner)).history[1].scope).toEqual({
      kind: "shot",
      id: "cup",
    });
  });
  it("rejects nonexistent targets and concurrent changes without losing the winner", async () => {
    const owner = await seed();
    await expect(
      saveCreationEmotion({
        ...owner,
        expectedRevision: 0,
        scope: { kind: "shot", id: "other" },
        intent: { raw: "温暖" },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const results = await Promise.allSettled(
      ["温暖", "不安"].map(raw =>
        saveCreationEmotion({
          ...owner,
          expectedRevision: 0,
          scope: { kind: "story" },
          intent: { raw },
        })
      )
    );
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await getCreationEmotion(owner)).history).toHaveLength(1);
    expect(await getCreationEmotionUsage(owner)).toEqual([]);
  });
});

it("lists shot-only emotion history even without a global intention", async () => {
  const owner = await seed();
  await handleCreationEmotionChat({
    ...owner,
    message: "把第01镜情绪改为：压抑不安，但音乐轻快反衬",
  });
  const local = await handleCreationEmotionChat({
    ...owner,
    message: "查看第01镜情绪历史",
  });
  expect(local?.reply).toContain("第01镜情绪 E1");
  expect(local?.reply).toContain("修订记录");
  expect(local?.reply).not.toContain("shot:cup");
  const global = await handleCreationEmotionChat({
    ...owner,
    message: "查看作品情绪历史",
  });
  expect(global?.reply).toContain("尚未设置");
  expect(global?.reply).toContain("音乐轻快反衬");
  expect((await getCreationEmotion(owner)).revision).toBe(1);
});

it("marks a chapter image older when the first chapter override is added after generation", async () => {
  const { insertChapter } = await import("../repositories/chapters");
  const { mutateModuleImageTasks } = await import("../repositories/bookModuleImageTasks");
  const owner = await seed();
  const chapter = await insertChapter({ ...owner, content: { title: "茶杯", layout: null, blocks: { body: "茶杯放下", blockIds: [], containsAiText: false, settings: null, coverKey: null, bodyTextureKey: null, images: {}, illustrations: [] } } });
  await saveCreationEmotion({...owner,expectedRevision:0,scope:{kind:"story"},intent:{raw:"温暖怀念"}});
  const story = await getStoryById(owner.storyId, owner.userId);
  const prompt = compileCreationEmotion(storyEmotion(story!.body), "art");
  const image = await mutateModuleImageTasks(owner, async (tasks, store) => {
    const candidates=await store([{imageUrl:"/api/images/emotion-chapter.png",prompt}]);
    tasks.push({id:"chapter-image",chapterId:chapter.id,moduleId:"block-1",requestId:"chapter-image-request",sourceHash:"hash",provider:"gpt-image",status:"succeeded",candidates});
    return candidates[0];
  });
  expect(await getCreationEmotionUsage(owner)).toContainEqual({kind:"art",id:String(image.imageId),status:"current"});
  await saveCreationEmotion({...owner,expectedRevision:1,scope:{kind:"chapter",id:String(chapter.id)},intent:{raw:"压抑不安"}});
  expect(await getCreationEmotionUsage(owner)).toContainEqual({kind:"art",id:String(image.imageId),status:"older-setting"});
  const {getGeneratedImageById}=await import("../repositories/images");
  expect((await getGeneratedImageById(image.imageId))?.prompt).toBe(prompt);
});
