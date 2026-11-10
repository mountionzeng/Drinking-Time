import { expect, it } from "vitest";
import { emptyStoryArtDirection, normalizeStoryArtDirection, type StoryArtRecipe } from "./artDirection";
import { activeArtSystemRecipe, artSystemPrompt, artSystemSkillMarkdown, artSystemChatReply, withArtSystemVideoPrompt } from "./artSystem";
import { parseArtSystemChat } from "./artSystemChat";
export const recipe: StoryArtRecipe = { version: 2, updatedAt: 100, sourceCandidateIds: [],
  style: ["ink wash"], palette: ["indigo"], composition: ["open space"], light: [], material: ["paper"], negative: ["photorealism"],
  system: { name: "墨色", intent: "采用宣纸", editorId: 1, editorName: "岱", operationToken: "token", englishPrompt: "Ink wash on textured paper with open negative space.",
    objectRules: ["keep teapot outline"], motionRules: ["slow flowing ink"], continuityRules: ["preserve brush grain"], referenceImageIds: [8], confirmedImageId: 8, confirmedAt: 100 },
};
it("routes art system commands before image production without fixing the artistic medium", () => {
  expect(parseArtSystemChat("我希望生成一套美术体系：极简且丰富细腻，物体沿用用户确认的基准图。先保存待确认版本，不生成图片或视频。" )).toEqual({ action: "draft" });
  expect(parseArtSystemChat("调整美术体系，改成水墨" )).toEqual({ action: "draft" });
  expect(parseArtSystemChat("修改美术体系：名称改为水墨。先不要生成图像或视频。" )).toEqual({ action: "draft" });
  expect(parseArtSystemChat("用图片 #8 作为美术基准" )).toEqual({ action: "confirm", imageId: 8 });
  expect(parseArtSystemChat("确认这套美术体系" )).toEqual({ action: "confirm" });
  expect(parseArtSystemChat("确认美术体系 V01" )).toEqual({ action: "confirm", recipeVersion: 1 });
  expect(parseArtSystemChat("使用故事 #9 的美术体系" )).toEqual({ action: "copy", sourceStoryId: 9 });
  expect(parseArtSystemChat("整体色彩再丰富一些", true)).toEqual({ action: "draft" });
  for (const text of ["不要确认美术体系", "如何建立美术体系？", "先不生成美术体系", "今天吃什么", "第02镜生成图片"]) expect(parseArtSystemChat(text, true)).toBeNull();
});
it("keeps the confirmed version active while a new draft is under discussion", () => {
  const draft = { ...recipe, version: 3, system: { ...recipe.system!, confirmedAt: undefined, englishPrompt: "Oil paint." } };
  const direction = normalizeStoryArtDirection({ ...emptyStoryArtDirection(), recipe: draft, recipeVersions: [recipe, draft], phase: "recipe-review" });
  expect(direction.recipe?.system?.editorName).toBe("岱");
  expect(activeArtSystemRecipe({ artDirection: direction })?.version).toBe(2);
  expect(artSystemPrompt({ artDirection: direction })).toContain("Ink wash");
  expect(artSystemPrompt({ artDirection: direction })).not.toContain("Oil paint");
  expect(artSystemChatReply(direction, 3)).toContain("待确认");
  expect(artSystemPrompt({ artDirection: { recipe: draft } })).toBe("");
});
it("exports a versioned creative Skill and bounds MJ/Vidu motion rules while preserving the shot action", () => {
  const skill = artSystemSkillMarkdown(recipe);
  expect(skill).toContain("岱"); expect(skill).toContain("Reference image IDs: 8"); expect(skill).toContain("slow flowing ink");
  expect(skill).toContain("not executable code");
  const body = { artDirection: { recipe } };
  for (const max of [500, 2000]) {
    const prompt = withArtSystemVideoPrompt("Camera slowly pans across the teapot. ".repeat(100), body, max);
    expect(prompt.length).toBeLessThanOrEqual(max); expect(prompt).toContain("Camera slowly pans"); expect(prompt).toContain("slow flowing ink");
  }
  expect(withArtSystemVideoPrompt("existing prompt", {}, 500)).toBe("existing prompt");
});
