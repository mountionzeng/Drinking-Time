import { expect, it, vi } from "vitest";
import { compareImagePixels, imagePixelChanges } from "./imagePixelChanges";

const source = { width: 2, height: 1, data: new Uint8ClampedArray([10, 20, 30, 255, 90, 80, 70, 255]) };
it("reports no differences for identical images, independent of any planned region", () => {
  expect(imagePixelChanges(source, source).changedPixels).toBe(0);
});
it("marks exactly the changed pixel, including alpha-only changes", () => {
  const candidate = { ...source, data: new Uint8ClampedArray(source.data) };
  candidate.data[7] = 254;
  const diff = imagePixelChanges(source, candidate);
  expect(diff.changedPixels).toBe(1);
  expect(diff.totalPixels).toBe(2);
  expect([...diff.pixels.slice(4)]).toEqual([236, 72, 153, 255]);
  expect([...diff.pixels.slice(0, 3)]).toEqual([10, 20, 30]);
});
it("rejects changed dimensions instead of silently resizing or claiming no changes", () => {
  expect(() => imagePixelChanges(source, { ...source, width: 1, height: 2 })).toThrow("size-mismatch");
  expect(() => imagePixelChanges(source, { ...source, data: new Uint8ClampedArray(4) })).toThrow("invalid-pixels");
});
it("propagates unavailable images instead of reporting success", async () => {
  const read = vi.fn().mockRejectedValue(new Error("image-unavailable"));
  await expect(compareImagePixels("source", "candidate", new AbortController().signal, read)).rejects.toThrow("image-unavailable");
});
it("discards a late comparison after the preview closes or switches image pair", async () => {
  const controller = new AbortController();
  let finish!: (value: typeof source) => void;
  const pending = new Promise<typeof source>(resolve => { finish = resolve; });
  const result = compareImagePixels("source", "candidate", controller.signal, () => pending);
  controller.abort();
  finish(source);
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
});
