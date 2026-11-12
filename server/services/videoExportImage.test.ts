import { expect, it, vi } from "vitest";
import sharp from "sharp";
import { renderExportImageBytes, renderExportImage } from "./videoExportImage";
import { DEFAULT_TIMELINE_TRANSFORM } from "../../shared/storyMaterial";
vi.mock("../persistence/storyVisualPersistence", () => ({
  loadAuthorizedStoryImage: vi.fn(async () => null),
}));
it("renders visible static pixels and applies preview translation", async () => {
  const bytes = await sharp({
    create: { width: 20, height: 20, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const output = await renderExportImageBytes(
    bytes,
    { ...DEFAULT_TIMELINE_TRANSFORM, zoom: 0.5, panX: 0.5 },
    { width: 100, height: 100 }
  );
  const { data, info } = await sharp(output)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) =>
    Array.from(
      data.subarray(
        (y * info.width + x) * info.channels,
        (y * info.width + x) * info.channels + 3
      )
    );
  expect(pixel(75, 50)).toEqual([255, 0, 0]);
  expect(pixel(10, 50)).toEqual([0, 0, 0]);
});
it("rejects unauthorized image ids before reading any image file", async () => {
  await expect(
    renderExportImage({
      storyId: 1,
      userId: 2,
      imageId: 99,
      transform: DEFAULT_TIMELINE_TRANSFORM,
      dimensions: { width: 100, height: 100 },
      outputPath: "/tmp/should-not-exist.png",
    })
  ).rejects.toThrow("不属于当前故事");
});


it("keeps alpha when explicitly rendering a composited image", async () => {
  const source = await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const output = await renderExportImageBytes(source, DEFAULT_TIMELINE_TRANSFORM, { width: 20, height: 20 }, "cover", true);
  const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
  expect(info.channels).toBe(4);
  expect(data[3]).toBe(0);
});
