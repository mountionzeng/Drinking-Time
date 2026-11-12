import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
const mocks = vi.hoisted(() => ({ store: vi.fn() }));
vi.mock("./imageAssets", () => ({ materializeImageInput: async (url: string) => url }));
vi.mock("./imageGen", () => ({ storeImageBytes: mocks.store }));
import { readImageDimensions, normalizeImageEditResult } from "./imageEditDimensions";

async function fixture(width: number, height: number, orientation?: number) {
  let image = sharp({ create: { width, height, channels: 3, background: "#eabfcc" } });
  if (orientation) image = image.withMetadata({ orientation });
  return `data:image/png;base64,${(await image.png().toBuffer()).toString("base64")}`;
}
beforeEach(() => {
  mocks.store.mockReset().mockImplementation(async (bytes: Uint8Array) => ({
    status: "ok", imageUrl: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`, imageKey: "normalized.png",
  }));
});
it("keeps an exact-size candidate byte-for-byte without rewriting it", async () => {
  const imageUrl = await fixture(960, 960);
  const { result, checks } = await normalizeImageEditResult({ status: "ok", imageUrl }, { width: 960, height: 960 });
  expect(result.imageUrl).toBe(imageUrl);
  expect(checks[imageUrl].status).toBe("matched");
  expect(mocks.store).not.toHaveBeenCalled();
});
it("restores only same-aspect output to the base dimensions, retaining the supplier result", async () => {
  const imageUrl = await fixture(1280, 1280);
  const { result, checks } = await normalizeImageEditResult({ status: "ok", imageUrl }, { width: 960, height: 960 });
  expect(await readImageDimensions(result.imageUrl!)).toEqual({ width: 960, height: 960 });
  expect(checks[result.imageUrl!]).toMatchObject({ status: "resized", provider: { width: 1280, height: 1280 }, originalImageUrl: imageUrl });
});
it("retains a wrong-aspect candidate for inspection but never stretches, crops or pads it", async () => {
  const imageUrl = await fixture(960, 540);
  const { result, checks } = await normalizeImageEditResult({ status: "ok", imageUrl }, { width: 960, height: 960 });
  expect(result.imageUrl).toBe(imageUrl);
  expect(checks[imageUrl]).toMatchObject({ status: "mismatch", expected: { width: 960, height: 960 }, output: { width: 960, height: 540 } });
  expect(mocks.store).not.toHaveBeenCalled();
});
it("uses displayed EXIF dimensions and validates every candidate", async () => {
  expect(await readImageDimensions(await fixture(80, 40, 6))).toEqual({ width: 40, height: 80 });
  const good = await fixture(40, 80), bad = await fixture(80, 40);
  const { checks } = await normalizeImageEditResult({ status: "ok", candidates: [{ imageUrl: good }, { imageUrl: bad }] }, { width: 40, height: 80 });
  expect(checks[good].status).toBe("matched");
  expect(checks[bad].status).toBe("mismatch");
});
it("retains unreadable results as unverified without pretending they match", async () => {
  const { checks } = await normalizeImageEditResult({ status: "ok", imageUrl: "data:image/png;base64,bm90LWltYWdl" }, { width: 960, height: 960 });
  expect(Object.values(checks)[0].status).toBe("unverified");
  expect(mocks.store).not.toHaveBeenCalled();
});
