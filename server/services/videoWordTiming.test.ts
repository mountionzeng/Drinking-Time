import { beforeEach, expect, it, vi } from "vitest";
import { cutVideoWord, persistWordCutReply } from "./videoWordTiming";
import { getStoryById, updateStoryBodyIfRevision } from "../repositories/stories";
import { findVideoTakeByIdempotencyKey, getVideoTakeById } from "../repositories/videos";
import { replacePrimaryTake } from "../repositories/replacePrimaryTake";
import { getStoryMaterialState } from "./storyMaterials";

vi.mock("../repositories/stories", () => ({getStoryById: vi.fn(), updateStoryBodyIfRevision: vi.fn()}));
vi.mock("../repositories/videos", () => ({findVideoTakeByIdempotencyKey: vi.fn(), getVideoTakeById: vi.fn()}));
vi.mock("../repositories/replacePrimaryTake", () => ({replacePrimaryTake: vi.fn()}));
vi.mock("./storyMaterials", () => ({getStoryMaterialState: vi.fn()}));

const input = { storyId: 12, stableShotId: "second", shotNo: 2, expectedTakeId: 8, sourceTakeId: 7,
  expectedVersion: 2, instruction: "把视频的“yourself”提前，句尾停一下", word: "yourself", hold: true, sentAt: 200, messageId: "msg-word" };
function material(version: number) {
  return { shots: [{shotNo: 2, stableShotId: "second"}], timeline: {version, items: [
    { stableShotId: "second", position: 0, included: true, durationFrames: 90, primaryVideoEdit: {takeId: 8} },
  ]}} as NonNullable<Awaited<ReturnType<typeof getStoryMaterialState>>>;
}
beforeEach(() => vi.resetAllMocks());
it("rejects stale edits and foreign source versions before cutting or replacing anything", async () => {
  vi.mocked(getStoryMaterialState).mockResolvedValue(material(3));
  await expect(cutVideoWord(input, 42)).rejects.toThrow("已经更新");
  vi.mocked(getStoryMaterialState).mockResolvedValue(material(2));
  vi.mocked(getVideoTakeById).mockResolvedValue(null);
  await expect(cutVideoWord(input, 42)).rejects.toThrow("不属于当前镜头");
  expect(replacePrimaryTake).not.toHaveBeenCalled();
});
it("recovers the receipt of an applied cut and does not save a second version", async () => {
  vi.mocked(getStoryMaterialState).mockResolvedValue(material(3));
  vi.mocked(findVideoTakeByIdempotencyKey).mockResolvedValue({status:"available",id:8,prompt:"12.80 秒"} as NonNullable<Awaited<ReturnType<typeof getVideoTakeById>>>);
  expect(await cutVideoWord(input, 42)).toMatchObject({takeId:8,reply:expect.stringContaining("已剪好")});
  expect(replacePrimaryTake).not.toHaveBeenCalled();
});
it("never returns completion when adopting the finished file loses the version race", async () => {
  vi.mocked(getStoryMaterialState).mockResolvedValue(material(2));
  vi.mocked(findVideoTakeByIdempotencyKey).mockResolvedValue({status:"available",id:9} as NonNullable<Awaited<ReturnType<typeof getVideoTakeById>>>);
  vi.mocked(replacePrimaryTake).mockRejectedValue(new Error("剪辑位置已更新"));
  await expect(cutVideoWord(input, 42)).rejects.toThrow("位置已更新");
});
it("persists the reply with its user turn across a concurrent archive write after the browser closes", async () => {
  const reply = "已剪好。";
  let body = { _revision: 4, editorDraft: "作者的草稿", messages: [
    {id:"newer",who:"u",text:"稍后的对话",timestamp:300},
  ]};
  vi.mocked(getStoryById).mockImplementation(async () => ({body}) as NonNullable<Awaited<ReturnType<typeof getStoryById>>>);
  vi.mocked(updateStoryBodyIfRevision).mockImplementation(async next => {
    if (body._revision === 4) {body={...body, _revision:5, editorDraft:"作者继续写"};return false;}
    body=next.body as typeof body;return true;
  });
  expect(await persistWordCutReply(input, 42, reply)).toBe(true);
  expect(await persistWordCutReply(input, 42, reply)).toBe(true);
  expect(body.editorDraft).toBe("作者继续写");
  expect(body.messages.map(m=>m.id)).toEqual(["msg-word","reply:msg-word","newer"]);
  expect(updateStoryBodyIfRevision).toHaveBeenCalledTimes(2);
});
