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

it("keeps visible actions but excludes spoken lines, sound directions and video transitions from still frames", () => {
  const body = { artDirection: { recipe: { version: 1, system: { name: "Ink", confirmedAt: 1, englishPrompt: "Black ink contours and warm ochre.", objectRules: ["round teapot handle", "不把参考图里的飞船搬入其他镜头"], continuityRules: ["coarse hatching"] } } } };
  const source = "现代海边的日常，与旧影像叠化。\n画外音（旁白）：「旧时的日子已经远去。」画面：老人和孩子在步道散步，阳光柔和。\n声音建议：风和海浪。\n字幕：「海边的一天」。";
  const prompt = unreferencedArtFramePrompt({body,shot:{subject:"步道上的老人和孩子",promptDraft:source}})!;
  expect(prompt).toContain("现代海边"); expect(prompt).toContain("老人和孩子在步道散步"); expect(prompt).toContain("round teapot handle");
  expect(prompt).not.toMatch(/画外音|旁白|旧时的日子|叠化|声音建议|风和海浪|字幕|海边的一天|飞船|参考图|画面：/);
  expect(source).toContain("旧时的日子");
});

it('treats the reviewed description as authoritative, retaining style without old subjects or neighboring scenes', async () => {
  const { composedStoryboardImagePrompt } = await import('./confirmedStoryboardImagePrompt');
  const prompt = composedStoryboardImagePrompt({ shots: [{ subject: '旧人物', location: '旧城堡', promptDraft: '废弃描述' }], artDirection: { recipe: {version: 1, system: { name: 'Ink', confirmedAt: 1, englishPrompt: 'Black ink and warm ochre.', objectRules: ['旧茶壶'], continuityRules: ['旧城堡'] } } } }, '图1中的花，置于现代海边。字幕：「海边」。');
  expect(prompt).toContain('图1中的花'); expect(prompt).toContain('现代海边'); expect(prompt).toContain('Black ink');
  expect(prompt).not.toMatch(/旧人物|旧城堡|废弃描述|旧茶壶|字幕/);
});

it("retains each object and its distinct action when composing a frame", async () => {
  const { composedStoryboardImagePrompt } = await import("./confirmedStoryboardImagePrompt");
  const action = "飞机飞进屏幕，旁边的小车倒退出画，电脑保持原位";
  const prompt = composedStoryboardImagePrompt({}, action);
  expect(prompt).toContain(action);
  expect(prompt).toContain("unless the action specifies otherwise");
  expect(prompt).toContain("local palette, material rendering and brush strokes");
});
