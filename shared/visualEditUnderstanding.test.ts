import { expect, it } from "vitest";
import { parseVisualUnderstandingChat, visualPreferencePrompt, visualReadingSchema } from "./visualEditUnderstanding";
it.each(["看看这张图片，哪些要保留", "分析图片 #2047，只改色彩细腻度", "查看图片修改记录", "inspect this image"])("routes inspection without buying generation: %s", text => expect(parseVisualUnderstandingChat(text)?.kind).toBe("inspect"));
it.each(["生成视频", "改小音乐音量", "替换原图", "我喜欢这张图", "不要记住我的美术偏好：点彩"])("does not invent preference consent: %s", text => expect(parseVisualUnderstandingChat(text)).toBeNull());
it("separates explicit preference scopes and operations", () => {
  expect(parseVisualUnderstandingChat("记住我的美术偏好：保留灰度" )).toEqual({ kind: "save", scope: "user", text: "保留灰度" });
  expect(parseVisualUnderstandingChat("更新这个镜头的美术偏好：更暖" )).toMatchObject({ kind: "save", scope: "shot" });
  expect(parseVisualUnderstandingChat("忘记这部作品的美术偏好" )).toMatchObject({ kind: "forget", scope: "story" });
});
it("puts current instructions above historical preferences without rewriting them", () => {
  const prompt = visualPreferencePrompt(["cold tones"], "warm tones only");
  expect(prompt).toContain("only apply to requested changes");
  expect(prompt.endsWith("warm tones only")).toBe(true);
  expect(visualReadingSchema.safeParse({ observed: "", change: [], preserve: [], uncertain: [] }).success).toBe(false);
});

it("treats omitted change/preserve/uncertain lists as empty but still requires observations", () => {
  expect(visualReadingSchema.parse({ observed: "柔和点彩" })).toEqual({ observed: "柔和点彩", change: [], preserve: [], uncertain: [] });
  expect(visualReadingSchema.safeParse({ change: [] }).success).toBe(false);
  expect(visualReadingSchema.safeParse({ observed: "x", change: "更细腻" }).success).toBe(false);
});
