import { expect, it } from "vitest";
import { isProviderPublicImageUrl, needsProviderImageCopy } from "../../shared/providerImageUrl";

it("accepts only anonymous public HTTPS URLs and flags private or local style sources for a hosted copy", () => {
  expect(isProviderPublicImageUrl("https://files.example.com/style.jpg")).toBe(true);
  expect(needsProviderImageCopy("https://files.example.com/style.jpg")).toBe(false);
  for (const url of [
    "/api/images/style.png",
    "/local-images/style.png",
    "/api/wechat-import/media/" + "a".repeat(64) + ".jpg",
    "data:image/png;base64,abc",
    "http://cdn.example.com/style.jpg",
    "https://localhost/style.jpg",
    "https://127.0.0.1/style.jpg",
    "https://192.168.1.2/style.jpg",
    "https://files.example.com/api/images/style.png",
  ]) {
    expect(isProviderPublicImageUrl(url), url).toBe(false);
    expect(needsProviderImageCopy(url), url).toBe(true);
  }
});
