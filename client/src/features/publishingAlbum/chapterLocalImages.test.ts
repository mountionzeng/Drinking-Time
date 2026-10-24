import { expect, it } from "vitest";
import { chapterLocalImages } from "./chapterLocalImages";
it("moves repeated local image bytes out of layout and preserves the original draft", () => {
  const url = "data:image/png;base64,YWJj";
  const edit: Parameters<typeof chapterLocalImages>[0] = { layout: { version: 1, pages: [{ label: "页", modules: [{ id: "i", kind: "image", imageUrl: url, rect: { x: 0, y: 0, width: 1, height: 1 }, crop: { x: 0, y: 0, width: 1, height: 1 } }] }] }, settings: null, media: { coverKey: url, bodyTextureKey: null, illustrations: [] } };
  const result = chapterLocalImages(edit);
  expect(result.localImages).toEqual([{ ref: "local-image:0", base64: "YWJj" }]);
  expect(result.layout?.pages[0].modules[0]).toHaveProperty("imageUrl", "local-image:0");
  expect(result.media?.coverKey).toBe("local-image:0");
  expect(edit.layout?.pages[0].modules[0]).toHaveProperty("imageUrl", url);
});
it("refuses unsupported inline images", () => {
  expect(() => chapterLocalImages({ layout: null, settings: null, media: { coverKey: "data:image/svg+xml;base64,YWJj", bodyTextureKey: null, illustrations: [] } })).toThrow("格式");
});
