import { expect, it } from "vitest";
import { confirmedStoryboardImagePrompt, unreferencedArtFramePrompt } from "./confirmedStoryboardImagePrompt";

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


it("sends affirmative scene prose rather than editorial headings when no images are selected", () => {
  const prompt = unreferencedArtFramePrompt({ body: { artDirection: { recipe: { version: 1, updatedAt: 1, style: ["ink illustration"], system: { name: "Ink", confirmedAt: 1, englishPrompt: "Bold black ink contours, ochre and muted teal color blocks.", objectRules: ["angular stone edges"], continuityRules: ["coarse ink hatching"] } } } }, shot: { subject: "行人", promptDraft: "图片要求（最高优先级）：现代街景。字幕：「纸船邮局」。" } })!;
  expect(prompt).toContain("现代街景"); expect(prompt).toContain("Bold black ink");
  expect(prompt).not.toMatch(/图片要求|纸船邮局|字幕|【|reference sheet|annotation/);
  expect(unreferencedArtFramePrompt({ body: {}, shot: { promptDraft: "街景" } })).toBeNull();
});
