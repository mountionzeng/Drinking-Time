import { describe, expect, it, vi } from "vitest";

import {
  exportPublishingAlbum,
  renderPublishingAlbumPagePng,
  type PublishingAlbumExportPage,
} from "./publishingAlbumExport";

function page(text = "你好"): PublishingAlbumExportPage {
  return {
    pageId: "page-1", ordinal: 1, backgroundUrl: "/background.png",
    plan: {
      kind: "region", text, fontId: "noto-serif-sc", fontFamily: "Noto Serif",
      fontSize: 40, alignment: "center",
      graphemes: Array.from(text).map((grapheme, index) => ({ grapheme, index, x: 100 + index * 50, y: 200, rotation: 0 })),
      contrast: { textColor: "#fff", outlineColor: "#000", outlineWidth: 1, backdropColor: null },
      svgPath: null,
    },
  };
}

describe("publishing album export", () => {
  it.each(["remote", "local"])("waits for the font and renders %s background without unnecessary network access", async source => {
    const order: string[] = [];
    const repository = {
      load: vi.fn(async () => { order.push("font-load"); }),
      missingCharacters: vi.fn(async () => []),
    } as any;
    const context = {
      drawImage: vi.fn(), save: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
      measureText: vi.fn(() => ({ width: 40 })), fillRect: vi.fn(),
      strokeText: vi.fn(), fillText: vi.fn(), restore: vi.fn(),
      textAlign: "", textBaseline: "", lineJoin: "", font: "", fillStyle: "", strokeStyle: "", lineWidth: 0,
    };
    const canvas = {
      width: 0, height: 0,
      getContext: vi.fn(() => context),
      toBlob: (callback: (blob: Blob | null) => void) => callback(new Blob(["png"], { type: "image/png" })),
    } as any;
    const fontsReady = Promise.resolve().then(() => { order.push("fonts-ready"); });
    const background = new Blob(["image"], { type: "image/png" });
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, blob: async () => background } as Response));
    const createBitmap = vi.fn(async () => ({ width: 900, height: 1200, close: vi.fn() } as any));
    const blob = await renderPublishingAlbumPagePng({
      page: page(), repository,
      backgroundBlob: source === "local" ? background : undefined,
      dependencies: {
        fontsReady,
        fetcher,
        createBitmap,
        createCanvas: () => canvas,
      },
    });
    expect(order).toEqual(["font-load", "fonts-ready"]);
    expect(context.drawImage).toHaveBeenCalledTimes(1);
    expect(context.fillText.mock.calls.map(call => call[0]).join("")).toBe("你好");
    expect(blob.type).toBe("image/png");
    expect(fetcher).toHaveBeenCalledTimes(source === "local" ? 0 : 1);
    expect(createBitmap).toHaveBeenCalledWith(background);
  });

  it("rejects unsafe controls and missing glyphs instead of exporting a wrong fallback", async () => {
    const repository = { load: vi.fn(), missingCharacters: vi.fn(async () => ["𠀀"]) } as any;
    await expect(renderPublishingAlbumPagePng({ page: page("安全\u202e反转"), repository })).rejects.toThrow("控制字符");
    await expect(renderPublishingAlbumPagePng({ page: page("𠀀"), repository })).rejects.toThrow("缺少字形");
  });

  it("exports a whole album sequentially with numbering and progress", async () => {
    const progress: string[] = [];
    const render = vi.fn(async () => new Blob(["png"], { type: "image/png" }));
    const pages = [page(), { ...page(), pageId: "page-2", ordinal: 2 }];
    const results = await exportPublishingAlbum({
      pages, filenamePrefix: "我的画册", render,
      onProgress: (completed, total) => progress.push(`${completed}/${total}`),
    });
    expect(results.map(result => result.filename)).toEqual(["我的画册-01.png", "我的画册-02.png"]);
    expect(progress).toEqual(["1/2", "2/2"]);
    expect(render).toHaveBeenCalledTimes(2);
  });
});
