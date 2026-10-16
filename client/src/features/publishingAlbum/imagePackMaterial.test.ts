import { afterEach, describe, expect, it, vi } from "vitest";
import { paletteFromPixels, paperPaletteFromImages, readImagePackPalettes } from "./imagePackMaterial";

function luminance(hex: string) {
  const rgb = hex.slice(1).match(/../g)!.map(value => {
    const c = parseInt(value, 16) / 255;
    return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  });
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}

describe("cover-derived paper palette", () => {
  it("follows the dominant cover color and ignores transparent pixels and white margins", () => {
    const warm = [170, 110, 65, 255];
    const palette = paletteFromPixels([...warm, ...warm, 20, 70, 170, 255, 255, 255, 255, 255, 0, 240, 0, 0]);
    expect(palette).toEqual(paletteFromPixels(warm));
    expect(palette).not.toEqual(paletteFromPixels([20, 70, 170, 255]));
  });

  it("keeps text readable on every palette including dark, light and saturated covers", () => {
    for (const rgb of [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255], [170, 110, 65]]) {
      const { paper, ink } = paletteFromPixels([...rgb, 255]);
      expect((luminance(paper) + .05) / (luminance(ink) + .05)).toBeGreaterThan(7);
    }
    expect(paletteFromPixels([]).paper).toMatch(/^#[a-f0-9]{6}$/);
  });

  it("preserves the first encountered dominant color when counts tie", () => {
    const warm = [170, 110, 65, 255];
    const blue = [20, 70, 170, 255];
    expect(paletteFromPixels([...warm, ...blue])).toEqual(paletteFromPixels(warm));
    expect(paletteFromPixels([...blue, ...warm])).toEqual(paletteFromPixels(blue));
  });

});

describe("free paper follows selected images", () => {
  it("combines cover and illustration colors, including illustration-only layouts", () => {
    const warm = [170, 110, 65, 255], blue = [20, 70, 170, 255];
    const combined = paperPaletteFromImages(warm, [blue]);
    expect(combined).not.toEqual(paperPaletteFromImages(warm, []));
    expect(combined).not.toEqual(paperPaletteFromImages(undefined, [blue]));
    expect(paperPaletteFromImages(undefined, [blue])).toEqual(paperPaletteFromImages(blue, []));
    expect(paperPaletteFromImages(warm, [[], [255, 255, 255, 255]])).toEqual(paperPaletteFromImages(warm, []));
    expect(luminance(paperPaletteFromImages(warm, []).paper)).toBeLessThan(luminance(paletteFromPixels(warm).paper) - .1);
  });

  it("keeps visible tints readable across dark, light and saturated sources", () => {
    for (const r of [0, 51, 102, 153, 204, 255]) {
      for (const g of [0, 51, 102, 153, 204, 255]) {
        for (const b of [0, 51, 102, 153, 204, 255]) {
          const { paper, ink } = paperPaletteFromImages([r, g, b, 255], []);
          expect((luminance(paper) + .05) / (luminance(ink) + .05)).toBeGreaterThan(7);
        }
      }
    }
  });

  it("draws color from the artwork instead of neutral paper, without amplifying tiny colored marks", () => {
    const neutral = [215, 214, 210, 255], ochre = [190, 135, 65, 255];
    const mostlyPaper = [...Array(8).fill(neutral).flat(), ...ochre, ...ochre];
    expect(paperPaletteFromImages(mostlyPaper, [])).toEqual(paperPaletteFromImages(ochre, []));
    const tinyMark = [...Array(99).fill(neutral).flat(), ...ochre];
    expect(paperPaletteFromImages(tinyMark, [])).toEqual(paperPaletteFromImages(neutral, []));
  });

  afterEach(() => vi.unstubAllGlobals());

  function samplingEnvironment() {
    const samples = [new Uint8ClampedArray([170, 110, 65, 255]), new Uint8ClampedArray([20, 70, 170, 255])];
    const fetcher = vi.fn(async () => ({ ok: true, blob: async () => new Blob() }));
    const close = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close })));
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({
      drawImage: vi.fn(), getImageData: () => ({ data: samples.shift()! }),
    }) }) });
    return { fetcher, close };
  }

  it("samples only the supplied selections, deduplicates URLs and closes decoded images", async () => {
    const { fetcher, close } = samplingEnvironment();
    const result = await readImagePackPalettes("/cover.png", ["/blue.png", "/blue.png", "/cover.png"], new AbortController().signal);
    expect(fetcher.mock.calls.map(call => (call as unknown[])[0])).toEqual(["/cover.png", "/blue.png"]);
    expect(result.palette).toEqual(paletteFromPixels([170, 110, 65, 255]));
    expect(result.paperPalette).toEqual(paperPaletteFromImages([170, 110, 65, 255], [[20, 70, 170, 255]]));
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("does not return stale colors when selection changes during decode", async () => {
    const { close } = samplingEnvironment();
    const abort = new AbortController();
    vi.mocked(createImageBitmap).mockImplementation(async () => {
      abort.abort();
      return { close } as unknown as ImageBitmap;
    });
    await expect(readImagePackPalettes("/cover.png", [], abort.signal)).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
  });
});
