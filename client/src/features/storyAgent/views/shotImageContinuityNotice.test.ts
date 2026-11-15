import { expect, it } from "vitest";
import { shotImageContinuityNotice } from "./shotImageContinuityNotice";
import type { StoryMaterialState } from "@shared/storyMaterial";

const material = { artSystemStyle: { version: 2, name: "Ink" }, shots: [{ shotNo: 1, currentImage: { id: 15 } }] } as StoryMaterialState;
it("names the actual selected anchor and preserves style after an explicit opt-out", () => {
  const selected = shotImageContinuityNotice(material, { imageIds: [15], imagePurpose: "scene-style", assets: {} }, "zh");
  expect(selected).toContain("第 01 镜");
  expect(selected).toContain("脸型、发型和服装");
  const removed = shotImageContinuityNotice(material, { imageIds: [], assets: {} }, "zh");
  expect(removed).toContain("Ink");
  expect(removed).toContain("本次没有选择人物参考图");
  expect(removed).not.toContain("第 01 镜");
  expect(shotImageContinuityNotice(material, { imageIds: [], assets: {} }, "en")).toContain("Removed references are never silently restored");
});
it("explains film style separately from removed character references and honors shot style overrides", () => {
  const withStyle = { ...material, filmStyleReference: { version: 4, name: "Ink", imageId: 21, image: null } };
  const text = shotImageContinuityNotice(withStyle, {imageIds:[],assets:{}}, "zh");
  expect(text).toContain("图片 #21"); expect(text).toContain("停用全片画风参考");
  expect(text).toContain("不指定人物或构图"); expect(text).toContain("本次没有选择人物参考图");
  const overridden = shotImageContinuityNotice(withStyle, {imageIds:[],assets:{style:{assetId:"a",versionId:"v"}}}, "en");
  expect(overridden).toContain("selected style asset"); expect(overridden).not.toContain("image #21");
});
