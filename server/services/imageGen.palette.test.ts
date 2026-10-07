import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { readImageAverageColor } from "./imageGen";

describe("texture color reference", () => {
  it("extracts only RGB values locally without sending a reference image", async () => {
    const bytes = await sharp({ create: { width: 20, height: 30, channels: 3, background: "#beaA96" } }).png().toBuffer();
    const fetcher = vi.spyOn(globalThis, "fetch");
    try {
      expect(await readImageAverageColor(`data:image/png;base64,${bytes.toString("base64")}`)).toBe("rgb(190, 170, 150)");
      expect(fetcher).not.toHaveBeenCalled();
    } finally { fetcher.mockRestore(); }
  });
});
