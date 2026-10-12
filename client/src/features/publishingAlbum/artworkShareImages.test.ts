import { afterEach, expect, it, vi } from "vitest";
import { prepareArtworkShareImages } from "./artworkShareImages";
import { artworkShareCreateSchema } from "@shared/artworkShare";

afterEach(() => vi.unstubAllGlobals());

function browserImages(encode: (width: number) => string) {
  const revoke = vi.fn();
  vi.stubGlobal("URL", {
    createObjectURL: () => "blob:source",
    revokeObjectURL: revoke,
  });
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 2160;
      naturalHeight = 2880;
      onload = () => {};
      set src(_: string) {
        queueMicrotask(() => this.onload());
      }
    }
  );
  const draw = vi.fn();
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: draw }),
      toDataURL(this: { width: number }) {
        return encode(this.width);
      },
    }),
  });
  return { draw, revoke };
}

it("compresses a five-page PNG pack above 8 MB into a valid share payload without changing originals", async () => {
  const { draw, revoke } = browserImages(
    () => `data:image/webp;base64,${"A".repeat(120_000)}`
  );
  const originals = Array.from(
    { length: 5 },
    () => new Blob([new Uint8Array(2_000_000)], { type: "image/png" })
  );
  const pages = await prepareArtworkShareImages(originals);
  expect(
    artworkShareCreateSchema.safeParse({
      storyId: 1,
      token: "12345678-1234-4234-8234-123456789012",
      title: "测试",
      pages,
    }).success
  ).toBe(true);
  expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 1080, 1440);
  expect(revoke).toHaveBeenCalledTimes(5);
  expect(
    originals.every(
      blob => blob.size === 2_000_000 && blob.type === "image/png"
    )
  ).toBe(true);
});

it("accounts for base64 and per-page limits, including PNG fallback on older browsers", async () => {
  browserImages(
    width =>
      `data:image/png;base64,${"A".repeat(width > 720 ? 4_500_000 : 500_000)}`
  );
  const pages = await prepareArtworkShareImages([new Blob()]);
  expect(pages[0].length).toBeLessThan(4 * 1024 * 1024);
});

it("reports an uncompressible page and releases its source URL", async () => {
  const { revoke } = browserImages(
    () => `data:image/webp;base64,${"A".repeat(4_500_000)}`
  );
  await expect(prepareArtworkShareImages([new Blob()])).rejects.toThrow(
    "第 1 张图片"
  );
  expect(revoke).toHaveBeenCalledTimes(1);
});
