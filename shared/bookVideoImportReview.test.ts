import { expect, it } from "vitest";
import { bookVideoImportReview } from "./bookVideoImportReview";
it("lists the book assets that need approval once and confines audio to its owner story", () => {
  const image = "![图片](/api/images/one.png)";
  const music = "![音乐:主题](/api/story-audio-asset/7/18)";
  const blocks = { body: [image, image, music, music, music.replace("/7/", "/8/")].join("\n") };
  const review = bookVideoImportReview(7, [{ blocks }]);
  expect(review.images).toEqual(["/api/images/one.png"]);
  expect(review.audio.map(a => a.assetId)).toEqual([18]);
  expect(review.dialogue).toEqual([]);
});
it("reports an empty manuscript without fabricated media", () => {
  expect(bookVideoImportReview(7, [])).toEqual({ shots: 0, images: [], audio: [], dialogue: [] });
});
