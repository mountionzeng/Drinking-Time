import { afterEach, expect, it, vi } from "vitest";
import { prepareBookShare } from "./prepareBookShare";
import { readImagePackBlob } from "./imagePackImageBlob";
import { encodeShareImage } from "./artworkShareImages";
vi.mock("./imagePackImageBlob", () => ({readImagePackBlob:vi.fn(async () => new Blob(["picture"]))}));
vi.mock("./artworkShareImages", () => ({encodeShareImage:vi.fn(async () => "data:image/webp;base64,AAAA")}));
afterEach(() => {vi.clearAllMocks();vi.unstubAllGlobals();});
it("prepares every unique picture before preview and releases decoded bitmaps", async () => {
  const close=vi.fn();vi.stubGlobal("createImageBitmap",vi.fn(async()=>({width:100,height:80,close})));
  const output=await prepareBookShare("正文\n![图片](/api/images/a.png)\n后文\n![图片](/api/images/a.png)");
  expect(output?.pages).toHaveLength(1);
  expect(output?.reading.blocks.filter(block=>block.kind==='image')).toHaveLength(2);
  expect(output?.pages[0]).toMatchObject({width:100,height:80,url:"data:image/webp;base64,AAAA"});
  expect(encodeShareImage).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();
});
it("fails instead of producing a text-only share when an image cannot be read", async () => {
  vi.mocked(readImagePackBlob).mockRejectedValueOnce(new Error("图片读取失败"));
  await expect(prepareBookShare("正文\n![图片](/api/images/missing.png)")).rejects.toThrow("图片读取失败");
  expect(encodeShareImage).not.toHaveBeenCalled();
});
