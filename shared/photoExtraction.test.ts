import { describe, expect, it } from "vitest";
import { isPhotoSaveOnlyReply, photoExtractionTarget } from "./photoExtraction";

describe("photo extraction replies", () => {
  it.each([
    ["只提取人物", "character"],
    ["小猫", "pet"],
    ["只提取宠物", "pet"],
    ["只提取背景", "scene"],
    ["只提取物体", "object"],
    ["提取整张", "all"],
    ["左边的花瓶，不要背景", "custom"],
    ["不要猫，只要背景", "custom"],
    ["第一张只要猫，第二张只要背景", "custom"],
  ])("keeps %s scoped as %s", (reply, target) => {
    expect(photoExtractionTarget(reply)).toBe(target);
  });
  it("does not confuse a save-only reply with an extraction request", () => {
    expect(isPhotoSaveOnlyReply("只保存图片")).toBe(true);
    expect(isPhotoSaveOnlyReply("先保存照片。")).toBe(true);
    expect(isPhotoSaveOnlyReply("不要提取，只保存图片")).toBe(true);
    expect(isPhotoSaveOnlyReply("先保存图片，不要分析")).toBe(true);
    expect(isPhotoSaveOnlyReply("不要只保存图片，提取小猫")).toBe(false);
  });
});
