import { expect, it } from "vitest";
import { bookImageRatioRequest, bookRoundRatio } from "./bookImageFrame";

it("accepts image format requests, including shot-specific and one-round changes", () => {
  expect(bookImageRatioRequest("以后出图都用方图")?.ratio).toBe("1:1");
  expect(bookImageRatioRequest("把第 08 镜的图片改成竖版。")).toMatchObject({ratio:"9:16",shotNo:8});
  expect(bookImageRatioRequest("这张图改成 4：3")).toMatchObject({ratio:"4:3",current:true});
  expect(bookRoundRatio("沿用木桌的材质，这次改成 3:2")).toBe("3:2");
  for (const text of ["拍一张正方形桌子的图片","视频改成16:9","不要改成竖版","图片比例是16:9？"]) {
    expect(bookImageRatioRequest(text)).toBeUndefined();
  }
});
