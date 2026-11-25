import { expect, it } from "vitest";
import { listsWholeStoryboard, requestedSceneGrouping, sceneOutlineViewRequest, storyboardUsesScenes } from "./bookShotFormat";

it("uses explicit outline instructions and the latest author choice", () => {
  for (const text of ["按场显示分镜", "请分成三场", "按场景分组"]) expect(requestedSceneGrouping(text)).toBe(true);
  for (const text of ["现场很安静", "每场比赛都下雨", "我想看看这段场景", "她说“按场显示分镜”", "要不要分场？"]) expect(requestedSceneGrouping(text)).toBeUndefined();
  expect(storyboardUsesScenes("", [{ role: "assistant", content: "建议分成三场" }])).toBe(false);
  expect(storyboardUsesScenes("只显示镜头", [{ role: "user", content: "按场显示分镜" }], true)).toBe(false);
  expect(sceneOutlineViewRequest("按场显示分镜")).toBe(true);
  expect(sceneOutlineViewRequest("请只显示镜头")).toBe(false);
  expect(sceneOutlineViewRequest("做一个视频，按场显示分镜")).toBeUndefined();
});

it("distinguishes listing the existing whole draft from a creative edit", () => {
  for (const text of ["把《纸船》新版本的所有镜头都整理出来", "请列出全片镜头", "整理完整分镜稿"])
    expect(listsWholeStoryboard(text)).toBe(true);
  for (const text of ["请整理第 2 镜", "重写全片分镜", "先别列出所有镜头", "请生成一套完整分镜", "他说“看看全片镜头”"])
    expect(listsWholeStoryboard(text)).toBe(false);
});
