import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), text: vi.fn(), video: vi.fn() }));
vi.mock("../repositories/textSourceLineage", () => ({ ownedCreationStory: mocks.read }));
vi.mock("./textDraftHistory", () => ({ generateTextDraft: mocks.text }));
vi.mock("./publishingVideoStoryboardPersistence", () => ({ generateAndPersistPublishingVideoPreview: mocks.video }));
import { replyToMobileCreativeIntent, VIDEO_INTENT_QUESTION } from "./mobileCreativeConversation";
import { readyDraft } from "../testing/creationFlowFixtures";
const input = {storyId: 7, userId: 3, clientTurnId: "turn-a", message: "", history: []};
beforeEach(() => { vi.resetAllMocks(); });
it("leaves ordinary edits on the existing mobile writing route", async () => {
  expect(await replyToMobileCreativeIntent({...input, message:"加一句话"})).toBeNull();
  expect(mocks.read).not.toHaveBeenCalled();
});
it("asks an open video question without invoking models", async () => {
  expect(await replyToMobileCreativeIntent({...input, message:"把图文做成视频"})).toBe(VIDEO_INTENT_QUESTION);
  expect(mocks.video).not.toHaveBeenCalled();
});
it("clarifies version intent without branching and supports cancellation", async () => {
  expect(await replyToMobileCreativeIntent({...input, message:"换个感觉"})).toContain("保留原版");
  expect(await replyToMobileCreativeIntent({...input, message:"取消", history:[{role:"assistant",content:VIDEO_INTENT_QUESTION}]})).toBe("好，当前作品保留。");
  expect(mocks.read).not.toHaveBeenCalled();
});
it("uses the specified saved text and preserves media without an extra recognition call", async () => {
  mocks.read.mockResolvedValue({body:{textDraftHistory:{schemaVersion:1, revision:1, versions:[readyDraft("draft-a")]}}});
  mocks.text.mockImplementation(async arg => ({versions:[{id:arg.operationToken,status:"ready",sequence:2,generated:{title:"新版",body:"新的文字"}}]}));
  const result = await replyToMobileCreativeIntent({...input,message:"用文字版本1再写一个搞笑版，原版留着"});
  expect(result).toContain("已另存文字版本2");
  expect(mocks.text.mock.calls[0][0]).toMatchObject({storyId:7,userId:3,parentId:"draft-a"});
  expect(mocks.video).not.toHaveBeenCalled();
});
it("does not substitute current text for an unknown old version", async () => {
  mocks.read.mockResolvedValue({body:{}});
  expect(await replyToMobileCreativeIntent({...input,message:"用《没有的稿》再写一版，原版保留"})).toContain("没有唯一对应");
  expect(mocks.text).not.toHaveBeenCalled();
});
it("carries an open-ended answer into a saved preview, without imposing duration presets", async () => {
  mocks.read.mockResolvedValue({body:{publishing:{version:1, revision:1,activePlatform:"xiaohongshu",selectedPlatforms:["xiaohongshu"],core:null,cover:null,coverRounds:[],updatedAt:1,drafts:{xiaohongshu:{platform:"xiaohongshu",content:{title:"",body:"一段原文",tags:[]},revision:1,sourceCoreRevision:0,needsReview:false,updatedAt:1}}}}});
  mocks.video.mockResolvedValue({status:"ready",preview:{shots:[{subject:"家",action:"归来",voiceText:"一段原文",videoRequirement:"静止",soundRequirement:"朗读"}]}});
  const result = await replyToMobileCreativeIntent({...input,message:"就像翻一本旧相册，让家里人安心，找个人念原文",history:[{role:"assistant",content:VIDEO_INTENT_QUESTION}]});
  expect(result).toContain("保存视频分镜草稿");
  expect(mocks.video.mock.calls[0][0]).toMatchObject({creativeIntent:"就像翻一本旧相册，让家里人安心，找个人念原文",articleLayout:{body:"一段原文",illustrations:[]}});
  expect(mocks.video.mock.calls[0][0]).not.toHaveProperty("narrativeSpec");
  expect(mocks.text).not.toHaveBeenCalled();
});

const envelope = (source: string, thought: string) => `我想接着这段文字聊。\n\n【引用文字】\n${source}\n【引用结束】\n\n【这次的新想法】\n${thought}`;
it("recognizes the actual request inside the existing mobile follow-up envelope", async () => {
  expect(await replyToMobileCreativeIntent({...input, message: envelope("原稿", "把图文做成视频")})).toBe(VIDEO_INTENT_QUESTION);
  expect(mocks.video).not.toHaveBeenCalled();
});
it("does not execute a version or video request quoted in the source", async () => {
  expect(await replyToMobileCreativeIntent({...input, message: envelope("保留原版，再写一版；把图文做成视频", "这句话什么意思？")})).toBeNull();
  expect(mocks.read).not.toHaveBeenCalled();
});
it("preserves the requested change when answering a version question from a mobile source", async () => {
  mocks.read.mockResolvedValue({body:{textDraftHistory:{schemaVersion:1,revision:1,versions:[readyDraft("draft-a")]}}});
  mocks.text.mockImplementation(async arg => ({versions:[{id:arg.operationToken,status:"ready",sequence:2,generated:{title:"新版",body:"新的文字"}}]}));
  await replyToMobileCreativeIntent({...input,message:"保留原版",history:[
    {role:"user",content:envelope("不应进入指令的引用", "用文字版本1换个感觉")},
    {role:"assistant",content:"直接修改当前作品，还是保留原版再试一版？"}
  ]});
  expect(mocks.text.mock.calls[0][0].instruction).toBe("用文字版本1换个感觉，原版保留，再写一版");
});

it("does not mistake a local layout page for the full saved article", async () => {
  mocks.read.mockResolvedValue({body:{publishing:{activePlatform:"xiaohongshu",drafts:{xiaohongshu:{platform:"xiaohongshu",content:{title:"",body:"已保存正文",tags:[]}}}}}});
  const result = await replyToMobileCreativeIntent({...input,message:"把图文做成视频，找个人念出来",writingContext:{draft:"本页文字",cursor:0,layoutMemory:{storyId:7,scope:"local",total:0,recent:[]}}});
  expect(result).toContain("只保存在本机");
  expect(mocks.video).not.toHaveBeenCalled();
});
it("does not silently use saved text when the mobile text has changed", async () => {
  mocks.read.mockResolvedValue({body:{publishing:{activePlatform:"xiaohongshu",drafts:{xiaohongshu:{platform:"xiaohongshu",content:{title:"",body:"已保存正文",tags:[]}}}}}});
  expect(await replyToMobileCreativeIntent({...input,message:"把图文做成视频，找个人念出来",writingContext:{draft:"未保存修改",cursor:0}})).toContain("未保存");
  expect(mocks.video).not.toHaveBeenCalled();
});

it("does not confuse a polite video request with a stated creative purpose", async () => {
  expect(await replyToMobileCreativeIntent({...input,message:"我希望把图文做成视频"})).toBe(VIDEO_INTENT_QUESTION);
  expect(mocks.read).not.toHaveBeenCalled();
});

it("omits empty title brackets when the generated version has no title", async () => {
  mocks.read.mockResolvedValue({body:{textDraftHistory:{schemaVersion:1,revision:1,versions:[readyDraft("draft-a")]}}});
  mocks.text.mockImplementation(async arg => ({versions:[{id:arg.operationToken,status:"ready",sequence:2,generated:{title:"",body:"新版正文"}}]}));
  const result = await replyToMobileCreativeIntent({...input,message:"用文字版本1再写一版，原版保留"});
  expect(result).toContain("已另存文字版本2。");
  expect(result).not.toContain("《》");
});
