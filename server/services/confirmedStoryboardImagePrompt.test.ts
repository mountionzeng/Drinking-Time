import { expect, it } from "vitest";
import { confirmedStoryboardImagePrompt } from "./confirmedStoryboardImagePrompt";

it("renders a single scene, retains the locked film style, and excludes screen lettering", () => {
  const shot = { stableShotId: "s1", shotNo: 1, subject: "城门", action: "城门打开。字幕：「归乡」。", promptDraft: "旧城门近景。字幕：「归乡」。", publishingVideo: { groupId: "g", draftShotId: "d" } };
  const body = { shots: [shot], artDirection: { phase: "locked", recipe: { version: 2, style: ["woodcut illustration"], palette: ["ochre and teal"], material: ["ink hatching"] } } };
  const prompt = confirmedStoryboardImagePrompt({ shot, body, title: "城门" })!;
  expect(prompt).toContain("woodcut illustration");
  expect(prompt).toContain("ochre and teal");
  expect(prompt).toContain("旧城门近景");
  expect(prompt).not.toContain("归乡");
  expect(prompt).not.toContain("interface");
  expect(prompt).not.toContain("supplied reference");
  expect(prompt.length).toBeLessThan(900);
  expect(confirmedStoryboardImagePrompt({ shot, body: { shots: [shot], artDirection: { ...body.artDirection, phase: "recipe-review" } }, title: "城门" })).not.toContain("woodcut illustration");
});

it("keeps interface-specific rendering for actual interface scenes", () => {
  const shot = { promptDraft: "网页里的茶壶和对话框", publishingVideo: { groupId: "g", draftShotId: "d" } };
  expect(confirmedStoryboardImagePrompt({ shot, body: {}, title: "工具" })).toContain("Render the interface artwork itself");
});
