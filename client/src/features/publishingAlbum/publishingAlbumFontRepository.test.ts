import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  PublishingAlbumFontRepository,
  fontBufferMissingCharacters,
  fontBufferSupportsCodePoint,
} from "./publishingAlbumFontRepository";

function binary(relativePath: string): ArrayBuffer {
  const bytes = readFileSync(resolve(process.cwd(), relativePath));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("PublishingAlbumFontRepository", () => {
  it("reads real cmap coverage for Chinese, punctuation, digits and Latin", () => {
    const buffer = binary("client/src/assets/fonts/publishing-album/noto-sans-sc/NotoSansSC[wght].ttf");
    for (const character of "中国，。！？2026ABC") {
      expect(fontBufferSupportsCodePoint(buffer, character.codePointAt(0)!)).toBe(true);
    }
    expect(fontBufferMissingCharacters(buffer, "中文A1，\n第二段\r\n")).toEqual([]);
  });

  it("lists only installed fonts and caches one selected font load", async () => {
    const buffer = binary("client/src/assets/fonts/publishing-album/noto-serif-sc/NotoSerifSC[wght].ttf");
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => buffer } as Response));
    const added: unknown[] = [];
    class FakeFontFace {
      constructor(public family: string, public source: ArrayBuffer) {}
      async load() { return this; }
    }
    const repository = new PublishingAlbumFontRepository({
      fetcher: fetcher as typeof fetch,
      FontFaceCtor: FakeFontFace,
      fontSet: { add: face => added.push(face) },
    });
    expect(repository.list()).toHaveLength(5);
    expect(repository.list().some(font => font.fontId === "lxgw-wenkai")).toBe(false);
    await repository.load("noto-serif-sc");
    await repository.load("noto-serif-sc");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(added).toHaveLength(1);
  });

  it("loads Noto fallback only after the selected font reports a missing glyph", async () => {
    const zcool = binary("client/src/assets/fonts/publishing-album/zcool-xiaowei/ZCOOLXiaoWei-Regular.ttf");
    const noto = binary("client/src/assets/fonts/publishing-album/noto-sans-sc/NotoSansSC[wght].ttf");
    const fetcher = vi.fn(async (url: string | URL | Request) => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => String(url).includes("ZCOOL") ? zcool : noto,
    } as Response));
    class FakeFontFace {
      constructor(public family: string, public source: ArrayBuffer) {}
      async load() { return this; }
    }
    const repository = new PublishingAlbumFontRepository({
      fetcher: fetcher as typeof fetch,
      FontFaceCtor: FakeFontFace,
      fontSet: { add: () => undefined },
    });
    const common = await repository.loadSelectedWithFallback("zcool-xiaowei", "你好");
    expect(common.fallbackFontId).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const rare = await repository.loadSelectedWithFallback("zcool-xiaowei", "你好𠀀");
    expect(rare.fallbackFontId).toBe("noto-sans-sc");
    expect(rare.missingCharacters).toContain("𠀀");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects research-only fonts", async () => {
    const repository = new PublishingAlbumFontRepository();
    await expect(repository.load("lxgw-wenkai")).rejects.toThrow("未安装");
  });
});
