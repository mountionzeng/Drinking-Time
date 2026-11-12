import { describe, expect, it } from "vitest";
import type { CreationEditorShot } from "@/features/creationEditor/types";
import { explicitImageFrameRole, resolveExplicitFrameRole } from "./chatFrameRole";

describe("explicitImageFrameRole", () => {
  it.each([
    ["把图片 #2047 设为尾帧", { imageId: 2047, role: "last", shotNo: null }],
    ["第3镜把图片 #2045 设为首帧", { imageId: 2045, role: "first", shotNo: 3 }],
    ["第三镜，用 #2046 作为参考帧。", { imageId: 2046, role: "reference", shotNo: 3 }],
    ["#2047 当第 3 镜的尾帧", { imageId: 2047, role: "last", shotNo: 3 }],
  ])("%s", (text, expected) => expect(explicitImageFrameRole(text)).toEqual(expected));

  it.each(["把这张设为尾帧", "把图片 #2047 设为尾帧，然后生成视频", "图片 #2047 太暗了", "第3镜生成视频"])("ignores %s", text => {
    expect(explicitImageFrameRole(text)).toBeNull();
  });
});

describe("resolveExplicitFrameRole", () => {
  const image = (id: number) => ({ id, imageUrl: `/api/images/${id}.png` });
  const shot = (shotNo: number, ids: number[]) => ({ shotNo, stableShotId: `s${shotNo}`, imageVersions: ids.map(image), generationParams: null }) as unknown as CreationEditorShot;
  const shots = [shot(2, [2001]), shot(3, [2045, 2046, 2047])];

  it("finds the only shot that owns the image", () => {
    const found = resolveExplicitFrameRole({ imageId: 2047, role: "last", shotNo: null }, shots);
    expect("shot" in found && found.shot.shotNo).toBe(3);
  });
  it("refuses an image that is not in the named shot", () => {
    expect(resolveExplicitFrameRole({ imageId: 2001, role: "last", shotNo: 3 }, shots)).toEqual({ error: expect.stringMatching(/还没有关联到第 3 镜/) });
  });
  it("asks for a shot number when it cannot tell", () => {
    expect(resolveExplicitFrameRole({ imageId: 9999, role: "first", shotNo: null }, shots)).toEqual({ error: expect.stringMatching(/请写明镜号/) });
  });
});
