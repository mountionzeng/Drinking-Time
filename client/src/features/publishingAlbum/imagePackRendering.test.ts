import { afterEach, describe, expect, it, vi } from "vitest";
import { makeImagePack } from "./imagePackComposition";
import { imagePackParagraphs } from "./imagePackIllustrations";
import { PublishingAlbumFontRepository } from "./publishingAlbumFontRepository";

// Exercise the real layout and PNG exporter with a deterministic canvas/font adapter.
function renderingEnvironment() {
  vi.spyOn(PublishingAlbumFontRepository.prototype, "load").mockResolvedValue({} as any);
  vi.spyOn(PublishingAlbumFontRepository.prototype, "missingCharacters").mockResolvedValue([]);
  const contexts: ReturnType<typeof createContext>[] = [];
  function createContext() {
    return {
      drawImage: vi.fn(), scale: vi.fn(), fillRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
      translate: vi.fn(), rotate: vi.fn(), fillText: vi.fn(), strokeText: vi.fn(),
      measureText: vi.fn(() => ({ width: 36 })),
    };
  }
  const canvases: { width: number; height: number }[] = [];
  vi.stubGlobal("document", {
    fonts: { ready: Promise.resolve() },
    createElement: () => {
      const context = createContext();
      contexts.push(context);
      const canvas = {
        width: 0, height: 0, getContext: () => context,
        toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["png"], { type: "image/png" })),
      };
      canvases.push(canvas);
      return canvas;
    },
  });
  const fetcher = vi.fn(async (url: string) => ({ ok: true, blob: async () => new Blob([url], { type: "image/png" }) }));
  vi.stubGlobal("fetch", fetcher);
  const bitmaps: { width: number; height: number; close: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal("createImageBitmap", async () => {
    const bitmap = { width: 900, height: 1200, close: vi.fn() };
    bitmaps.push(bitmap);
    return bitmap;
  });
  return { contexts, canvases, bitmaps, fetcher };
}

const base = { title: "标题", fontId: "noto-serif-sc", style: "sage" as const, includeCover: false, bodyTextureUrl: "/texture.png" };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("multi-illustration PNG rendering", () => {
  it("renders text on both sides of an image, checks every block, and closes all bitmaps", async () => {
    const { contexts, bitmaps, fetcher } = renderingEnvironment();
    const body = "前文\n后文";
    const progress = vi.fn();
    const result = await makeImagePack({ ...base, body, illustrations: [{ imageUrl: "/image.png", after: imagePackParagraphs(body)[0].anchor }] }, progress, new AbortController().signal);
    expect(result).toHaveLength(1);
    expect(result[0].blob.type).toBe("image/png");
    const rendered = contexts.find(context => context.fillText.mock.calls.length > 0)!;
    expect(rendered.fillText.mock.calls.map(call => call[0]).join("")).toBe("前文后文");
    const glyphYs = rendered.translate.mock.calls.map(call => call[1]);
    const imageY = contexts[0].drawImage.mock.calls[1][2];
    expect(Math.max(...glyphYs.slice(0, 2)) / 2).toBeLessThan(imageY);
    expect(Math.min(...glyphYs.slice(2)) / 2).toBeGreaterThan(imageY + 416);
    expect(PublishingAlbumFontRepository.prototype.missingCharacters).toHaveBeenCalledWith(base.fontId, "前文");
    expect(PublishingAlbumFontRepository.prototype.missingCharacters).toHaveBeenCalledWith(base.fontId, "后文");
    expect(fetcher.mock.calls.filter(call => call[0] === "/image.png")).toHaveLength(1);
    expect(bitmaps.every(bitmap => bitmap.close.mock.calls.length === 1)).toBe(true);
    expect(progress).toHaveBeenLastCalledWith(1, 1);
  });

  it("exports image-only pages at full resolution and decodes reused assets only once", async () => {
    const { canvases, fetcher } = renderingEnvironment();
    const result = await makeImagePack({ ...base, body: "正文", illustrations: [
      { imageUrl: "/same.png", after: null }, { imageUrl: "/same.png", after: null },
    ] }, vi.fn(), new AbortController().signal);
    expect(result).toHaveLength(2);
    expect(canvases[0]).toMatchObject({ width: 1800, height: 2400 });
    expect(fetcher.mock.calls.filter(call => call[0] === "/same.png")).toHaveLength(1);
    expect(fetcher.mock.calls.filter(call => call[0] === "/texture.png")).toHaveLength(1);
  });

  it("rejects missing glyphs in later text blocks without returning a partial pack", async () => {
    const { bitmaps } = renderingEnvironment();
    vi.mocked(PublishingAlbumFontRepository.prototype.missingCharacters).mockImplementation(async (_font, text) => text.includes("𠀀") ? ["𠀀"] : []);
    const body = "前文\n𠀀";
    await expect(makeImagePack({ ...base, body, illustrations: [{ imageUrl: "/image.png", after: imagePackParagraphs(body)[0].anchor }] }, vi.fn(), new AbortController().signal)).rejects.toThrow("缺少字形");
    expect(bitmaps.every(bitmap => bitmap.close.mock.calls.length === 1)).toBe(true);
  });
});
