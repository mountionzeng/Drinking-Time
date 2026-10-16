import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createModuleRenderer,
  renderModulePack,
} from "./imagePackModuleRenderer";
import { PublishingAlbumFontRepository } from "./publishingAlbumFontRepository";
import {
  editModuleText,
  replaceModule,
  moveModuleToPage,
  insertModulePage,
  deleteModulePage,
  transformModule,
  newImageModule,
  type TextModule,
} from "./imagePackModules";

function environment() {
  vi.spyOn(PublishingAlbumFontRepository.prototype, "load").mockResolvedValue();
  vi.spyOn(
    PublishingAlbumFontRepository.prototype,
    "missingCharacters"
  ).mockResolvedValue([]);
  const contexts: ReturnType<typeof context>[] = [];
  function context() {
    return {
      drawImage: vi.fn(),
      scale: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      globalAlpha: 1,
      createPattern: vi.fn(() => null),
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      measureText: vi.fn(() => ({ width: 36 })),
    };
  }
  const canvases: HTMLCanvasElement[] = [];
  vi.stubGlobal("document", {
    createElement: () => {
      const ctx = context();
      contexts.push(ctx);
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toBlob: (callback: BlobCallback) =>
          callback(new Blob(["png"], { type: "image/png" })),
      } as unknown as HTMLCanvasElement;
      canvases.push(canvas);
      return canvas;
    },
  });
  const bitmaps: {
    width: number;
    height: number;
    close: ReturnType<typeof vi.fn>;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(["image"], { type: "image/png" }),
    }))
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => {
      const bitmap = { width: 900, height: 1200, close: vi.fn() };
      bitmaps.push(bitmap);
      return bitmap;
    })
  );
  return { contexts, canvases, bitmaps };
}
const options = {
  title: "标题",
  body: "第一段。\n第二段。",
  fontId: "noto-serif-sc",
  style: "sage" as const,
  includeCover: true,
  coverUrl: "/cover.png",
  bodyTextureUrl: "/paper.png",
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("module canvas and PNG agreement", () => {
  it("renumbers exported files after inserting and deleting pages, including an original cover", async () => {
    const { contexts } = environment();
    const renderer = await createModuleRenderer(
      options,
      new AbortController().signal
    );
    const original = renderer.createDocument();
    let document = insertModulePage(original, 0);
    document = insertModulePage(document, document.pages.length);
    document = deleteModulePage(document, 1);
    const exported = await renderModulePack(
      renderer,
      document,
      new AbortController().signal
    );
    expect(exported.map(page => page.filename)).toEqual([
      "图文-01.png",
      "图文-02.png",
      "图文-03.png",
    ]);
    const [first, body, last] = contexts.slice(-3);
    for (const blank of [first, last]) {
      expect(blank.drawImage).toHaveBeenCalledTimes(1);
      expect(blank.fillText).not.toHaveBeenCalled();
    }
    expect(body.fillText.mock.calls.map(call => call[0]).join("")).toBe(
      options.body.replaceAll("\n", "")
    );
    expect(body.drawImage).toHaveBeenCalledTimes(1);
    expect(original.pages).toHaveLength(2);
    renderer.dispose();
  });
  it("exports moved text and cropped images only on the destination page", async () => {
    const { contexts } = environment();
    const renderer = await createModuleRenderer(
      options,
      new AbortController().signal
    );
    let document = renderer.createDocument();
    const picture = document.pages[0].modules[0];
    const title = document.pages[0].modules[1] as TextModule;
    Object.assign(title, { emphasis: "bright", backdrop: true });
    document = replaceModule(
      document,
      0,
      transformModule(picture, "left", picture.rect.width / 4, 0)
    );
    document = moveModuleToPage(document, 0, picture.id, 2);
    document = moveModuleToPage(document, 0, title.id, 2);
    const preview = globalThis.document.createElement("canvas");
    preview.width = 900;
    preview.height = 1200;
    renderer.draw(document.pages[2], preview);
    const live = contexts.at(-1)!;
    const exported = await renderModulePack(
      renderer,
      document,
      new AbortController().signal
    );
    const source = contexts.at(-3)!;
    const target = contexts.at(-1)!;
    expect(exported).toHaveLength(3);
    expect(source.drawImage).toHaveBeenCalledTimes(1); // Paper only; neither moved module remains.
    expect(source.fillText).not.toHaveBeenCalled();
    expect(target.drawImage.mock.calls[1]).toEqual(
      live.drawImage.mock.calls[1]
    );
    expect(target.drawImage.mock.calls[1].slice(1, 5)).toEqual([
      225, 0, 675, 1200,
    ]);
    expect(target.fillText.mock.calls).toEqual(live.fillText.mock.calls);
    expect(target.fillRect.mock.calls).toEqual(live.fillRect.mock.calls);
    expect(target.strokeText.mock.calls).toEqual(live.strokeText.mock.calls);
    expect(target.fillText.mock.calls.map(call => call[0]).join("")).toBe(
      options.title
    );
    renderer.dispose();
  });
  it.each([
    ["normal", false],
    ["normal", true],
    ["bright", false],
    ["bright", true],
  ] as const)(
    "renders %s text with backdrop=%s consistently in preview and PNG",
    async (emphasis, backdrop) => {
      const { contexts } = environment();
      const renderer = await createModuleRenderer(
        options,
        new AbortController().signal
      );
      const document = renderer.createDocument();
      const title = document.pages[0].modules[1] as TextModule;
      Object.assign(title, { emphasis, backdrop });
      // Put the picture after text in stored flow: the text must still paint above it.
      document.pages[0].modules.reverse();
      const original = structuredClone(document);
      const canvas = globalThis.document.createElement("canvas");
      canvas.width = 900;
      canvas.height = 1200;
      const ctx = contexts.at(-1)!;
      const panels: { color: string; alpha: number }[] = [];
      ctx.fillRect.mockImplementation(() => {
        panels.push({ color: ctx.fillStyle, alpha: ctx.globalAlpha });
      });
      renderer.draw(document.pages[0], canvas);
      expect(ctx.drawImage.mock.invocationCallOrder.at(-1)!).toBeLessThan(
        ctx.fillText.mock.invocationCallOrder[0]
      );
      expect(ctx.fillStyle).toBe(emphasis === "bright" ? "#fffaf0" : "#294936");
      expect(panels).toEqual(
        backdrop
          ? [
              {
                color: emphasis === "bright" ? "#294936" : "#eef3e9",
                alpha: emphasis === "bright" ? 0.72 : 0.8,
              },
            ]
          : []
      );
      expect(ctx.strokeText).toHaveBeenCalledTimes(
        emphasis === "normal" ? 0 : title.text.length * (backdrop ? 1 : 2)
      );
      if (backdrop) {
        const [x, y, width, height] = ctx.fillRect.mock.calls[0] as number[];
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(width).toBeLessThan(title.contentWidth);
        expect(height).toBeLessThan(title.contentHeight);
        for (const [, glyphX, glyphY] of ctx.fillText.mock.calls as unknown as [
          string,
          number,
          number,
        ][]) {
          expect(glyphX).toBeGreaterThan(x);
          expect(glyphX).toBeLessThan(x + width);
          expect(glyphY).toBeGreaterThan(y);
          expect(glyphY).toBeLessThan(y + height);
        }
      }
      await renderModulePack(renderer, document, new AbortController().signal);
      const png = contexts[contexts.length - document.pages.length];
      expect(png.fillText.mock.calls).toEqual(ctx.fillText.mock.calls);
      expect(png.strokeText.mock.calls).toEqual(ctx.strokeText.mock.calls);
      expect(png.fillRect.mock.calls).toEqual(ctx.fillRect.mock.calls);
      expect(document).toEqual(original);
      // The same cached layout can return to normal without stale bright colors or weight.
      title.emphasis = "normal";
      title.backdrop = false;
      ctx.fillRect.mockClear();
      ctx.strokeText.mockClear();
      renderer.draw(document.pages[0], canvas);
      expect(ctx.fillStyle).toBe("#294936");
      expect(ctx.strokeText).not.toHaveBeenCalled();
      expect(ctx.fillRect).not.toHaveBeenCalled();
      renderer.dispose();
    }
  );
  it.each([false, true])(
    "uses image-derived colors only for free paper (AI background: %s)",
    async aiBackground => {
      const { contexts } = environment();
      const palette = { paper: "#f4efe8", ink: "#231e18", accent: "#927254" };
      const paperPalette = {
        paper: "#e4d1bd",
        ink: "#221c16",
        accent: "#927254",
      };
      const renderer = await createModuleRenderer(
        {
          ...options,
          palette,
          paperPalette,
          bodyTextureUrl: aiBackground ? options.bodyTextureUrl : undefined,
        },
        new AbortController().signal
      );
      expect(contexts[1].fillStyle).toBe(
        aiBackground ? palette.paper : paperPalette.paper
      );
      expect(contexts[1].drawImage).toHaveBeenCalledTimes(aiBackground ? 1 : 0);
      const pages = await renderModulePack(
        renderer,
        renderer.createDocument(),
        new AbortController().signal
      );
      expect(pages).toHaveLength(2);
      renderer.dispose();
    }
  );
  it("loads images added after the editor opened and restores them for PNG export", async () => {
    environment();
    const renderer = await createModuleRenderer(
      options,
      new AbortController().signal
    );
    const document = renderer.createDocument();
    const added = newImageModule("added", "/new-upload.png", {
      width: 900,
      height: 1200,
    });
    document.pages[1].modules.push(added);
    await renderer.validate(document);
    expect(fetch).toHaveBeenCalledWith(
      "/new-upload.png",
      expect.objectContaining({ credentials: "same-origin" })
    );
    const calls = vi.mocked(fetch).mock.calls.length;
    const results = await renderModulePack(
      renderer,
      document,
      new AbortController().signal
    );
    expect(results).toHaveLength(document.pages.length);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(calls);
    renderer.dispose();
  });
  it("draws the identical crop, text positions and scales in live preview and final PNG", async () => {
    const { contexts, bitmaps, canvases } = environment();
    const renderer = await createModuleRenderer(
      options,
      new AbortController().signal
    );
    let document = renderer.createDocument();
    const image = document.pages[0].modules[0];
    document = replaceModule(
      document,
      0,
      transformModule(image, "left", image.rect.width / 4, 0)
    );
    const title = document.pages[0].modules[1] as TextModule;
    document = replaceModule(
      document,
      0,
      transformModule(
        editModuleText(title, "修改后的标题", renderer.measure),
        "se",
        -40,
        -20
      )
    );
    const preview = globalThis.document.createElement("canvas");
    preview.width = 900;
    preview.height = 1200;
    renderer.draw(document.pages[0], preview);
    const live = contexts.at(-1)!;
    const results = await renderModulePack(
      renderer,
      document,
      new AbortController().signal
    );
    const exported = contexts[contexts.length - 2];
    expect(live.drawImage.mock.calls[1]).toEqual(
      exported.drawImage.mock.calls[1]
    );
    expect(live.drawImage.mock.calls[1].slice(1, 5)).toEqual([
      225, 0, 675, 1200,
    ]);
    expect(live.fillText.mock.calls).toEqual(exported.fillText.mock.calls);
    expect(live.translate.mock.calls).toEqual(exported.translate.mock.calls);
    expect(live.scale.mock.calls.slice(1)).toEqual(
      exported.scale.mock.calls.slice(1)
    );
    expect(live.fillText.mock.calls.map(call => call[0]).join("")).toBe(
      "修改后的标题"
    );
    expect(
      canvases.slice(-2).map(canvas => [canvas.width, canvas.height])
    ).toEqual([
      [1800, 2400],
      [1800, 2400],
    ]);
    expect(results.map(result => result.blob.type)).toEqual([
      "image/png",
      "image/png",
    ]);
    renderer.dispose();
    renderer.dispose();
    expect(bitmaps.every(bitmap => bitmap.close.mock.calls.length === 1)).toBe(
      true
    );
  });
  it("rejects missing characters and control characters before exporting", async () => {
    environment();
    const renderer = await createModuleRenderer(
      options,
      new AbortController().signal
    );
    const document = renderer.createDocument();
    vi.mocked(
      PublishingAlbumFontRepository.prototype.missingCharacters
    ).mockResolvedValue(["𠀀"]);
    await expect(
      renderModulePack(renderer, document, new AbortController().signal)
    ).rejects.toThrow("缺少字形");
    (document.pages[0].modules[1] as TextModule).text = "\u202e";
    await expect(
      renderModulePack(renderer, document, new AbortController().signal)
    ).rejects.toThrow("控制字符");
    renderer.dispose();
  });
  it("aborts before fetching and closes decoded resources if cancelled during loading", async () => {
    const { bitmaps } = environment();
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      createModuleRenderer(options, aborted.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
    const active = new AbortController();
    const decode = globalThis.createImageBitmap;
    vi.stubGlobal(
      "createImageBitmap",
      async (...args: Parameters<typeof decode>) => {
        const bitmap = await decode(...args);
        active.abort();
        return bitmap;
      }
    );
    await expect(
      createModuleRenderer(options, active.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(bitmaps).toHaveLength(1);
    expect(bitmaps[0].close).toHaveBeenCalledOnce();
  });
});
