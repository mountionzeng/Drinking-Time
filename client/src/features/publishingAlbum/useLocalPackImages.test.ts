import { describe, expect, it, vi } from "vitest";
import { prepareLocalPackImage } from "./useLocalPackImages";
import { optimizeImageForUpload } from "@/lib/imageUpload";

vi.mock("@/lib/imageUpload", () => ({ optimizeImageForUpload: vi.fn() }));
describe("layout local image import", () => {
  it("rejects unsupported image formats before decoding", async () => {
    await expect(
      prepareLocalPackImage(
        new File(["svg"], "test.svg", { type: "image/svg+xml" })
      )
    ).rejects.toThrow("PNG、JPG 或 WebP");
  });
  it("rejects files over the input limit", async () => {
    const file = new File([new Uint8Array(16 * 1024 * 1024)], "huge.png", {
      type: "image/png",
    });
    await expect(prepareLocalPackImage(file)).rejects.toThrow("15 MB");
  });
  it("keeps an optimized image local with a distinct asset id", async () => {
    vi.mocked(optimizeImageForUpload).mockResolvedValue({
      dataUrl: "data:image/png;base64,YQ==",
      optimizedBytes: 100,
    } as any);
    const result = await prepareLocalPackImage(
      new File(["png"], "我的图片.png", { type: "image/png" })
    );
    expect(result.id).toBeLessThan(0);
    expect(result.imageUrl).toBe("data:image/png;base64,YQ==");
    expect(result.label).toBe("我的图片.png");
  });
  it("rejects output too large for the local image library", async () => {
    vi.mocked(optimizeImageForUpload).mockResolvedValue({
      optimizedBytes: 3 * 1024 * 1024,
    } as any);
    await expect(
      prepareLocalPackImage(
        new File(["png"], "large.png", { type: "image/png" })
      )
    ).rejects.toThrow("2 MB");
  });
});
