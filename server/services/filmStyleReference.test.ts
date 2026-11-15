import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ image: vi.fn(), materialize: vi.fn(), provider: vi.fn() }));
vi.mock("../repositories/images", () => ({getGeneratedImageById: mocks.image}));
vi.mock("./imageAssets", () => ({materializeImageInput: mocks.materialize}));
vi.mock("./wechatVideoImage", () => ({wechatProviderReference: mocks.provider}));
import { resolveFilmStyleReference } from "./filmStyleReference";
const input = () => ({storyId:1,userId:2,hasExplicitStyle:false,references:{imageIds:[],assets:{},filmStyleVersion:4},
  body:{artDirection:{recipe:{version:4,system:{name:"Ink",confirmedAt:1,filmStyleImageId:7}}}}});
beforeEach(() => {
  vi.resetAllMocks(); mocks.image.mockResolvedValue({storyId:1,userId:2,imageUrl:"/api/wechat-import/media/owned.jpg"});
  mocks.materialize.mockResolvedValue("data:image/png;base64,owned"); mocks.provider.mockResolvedValue("https://private.test/signed");
});
it("resolves only the owned style image and uses the private-image signing pipeline", async () => {
  expect(await resolveFilmStyleReference(input())).toBe("https://private.test/signed");
  expect(mocks.materialize).toHaveBeenCalledWith("/api/wechat-import/media/owned.jpg",2);
  expect(mocks.provider).toHaveBeenCalledWith("/api/wechat-import/media/owned.jpg",2);
});
it("rejects stale quotes, missing and foreign images before submitting any render", async () => {
  await expect(resolveFilmStyleReference({...input(),references:{imageIds:[],assets:{}}})).rejects.toThrow("已更新");
  expect(mocks.image).not.toHaveBeenCalled();
  for (const image of [null,{storyId:9,userId:2,imageUrl:"/x"},{storyId:1,userId:3,imageUrl:"/x"}]) {
    mocks.image.mockResolvedValueOnce(image);
    await expect(resolveFilmStyleReference(input())).rejects.toThrow("已失效");
  }
  expect(mocks.materialize).not.toHaveBeenCalled();
  mocks.materialize.mockRejectedValueOnce(new Error("file missing"));
  await expect(resolveFilmStyleReference(input())).rejects.toThrow("无法读取");
  expect(mocks.provider).not.toHaveBeenCalled();
});
it("does not resurrect disabled film style and respects an explicit shot style", async () => {
  expect(await resolveFilmStyleReference({...input(),hasExplicitStyle:true})).toBeUndefined();
  expect(await resolveFilmStyleReference({...input(),body:{},references:{imageIds:[],assets:{},filmStyleVersion:0}})).toBeUndefined();
  await expect(resolveFilmStyleReference({...input(),body:{}})).rejects.toThrow("已更新");
  expect(mocks.image).not.toHaveBeenCalled();
});
