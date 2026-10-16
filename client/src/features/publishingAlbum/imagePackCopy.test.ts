import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyImagePackPages,
  imagePackCopyText,
  joinImagePackPages,
} from "./imagePackCopy";
import {
  newImageModule,
  newTextModule,
  type ModuleDocument,
} from "./imagePackModules";

afterEach(() => vi.unstubAllGlobals());
const png = (value: string) => new Blob([value], { type: "image/png" });
const signal = () => new AbortController().signal;

function canvasEnvironment() {
  const draw = vi.fn();
  const encoded: { width: number; height: number; type: string }[] = [];
  const result = png("joined");
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: draw }),
    toBlob: vi.fn((callback: BlobCallback, type: string) => {
      encoded.push({ width: canvas.width, height: canvas.height, type });
      callback(result);
    }),
  };
  const bitmaps: { source: Blob; close: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal("document", { createElement: () => canvas });
  const decode = vi.fn(async (source: Blob) => {
    const bitmap = { source, close: vi.fn() };
    bitmaps.push(bitmap);
    return bitmap;
  });
  vi.stubGlobal("createImageBitmap", decode);
  return { canvas, encoded, result, bitmaps, decode, draw };
}

describe("copy edited image packs", () => {
  it("copies current text in page order, preserving paragraphs, edits, duplicates and Unicode", () => {
    const text = (id: string, value: string) =>
      newTextModule(id, value, () => 12);
    const document: ModuleDocument = {
      version: 1,
      pages: [
        {
          label: "正文",
          modules: [
            newImageModule("image", "/cover.png", { width: 900, height: 1200 }),
            text("new", "新加的一句🙂"),
            text("empty", "  "),
          ],
        },
        {
          label: "正文",
          modules: [
            text("moved", "移过来的第一段\n还有一行"),
            text("duplicate", "新加的一句🙂"),
          ],
        },
      ],
    };
    expect(imagePackCopyText(document)).toBe(
      "新加的一句🙂\n\n移过来的第一段\n还有一行\n\n新加的一句🙂"
    );
    expect(
      imagePackCopyText({ version: 1, pages: [{ label: "空白", modules: [] }] })
    ).toBe("");
  });

  it("copies a single page without resizing or re-encoding it", async () => {
    const original = png("original");
    expect(await joinImagePackPages([original], signal())).toBe(original);
  });

  it("joins only the supplied pages in order and releases each bitmap and canvas", async () => {
    const { draw, bitmaps, encoded, canvas, result } = canvasEnvironment();
    const pages = [png("page2"), png("page5")];
    expect(await joinImagePackPages(pages, signal())).toBe(result);
    expect(bitmaps.map(bitmap => bitmap.source)).toEqual(pages);
    expect(draw.mock.calls).toEqual([
      [bitmaps[0], 0, 0, 900, 1200],
      [bitmaps[1], 0, 1200, 900, 1200],
    ]);
    expect(encoded).toEqual([{ width: 900, height: 2400, type: "image/png" }]);
    expect(bitmaps.every(bitmap => bitmap.close.mock.calls.length === 1)).toBe(
      true
    );
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it("keeps a full nine-page strip within mobile canvas dimensions", async () => {
    const { encoded } = canvasEnvironment();
    await joinImagePackPages(
      Array.from({ length: 9 }, () => png("page")),
      signal()
    );
    expect(encoded[0]).toEqual({
      width: 900,
      height: 10800,
      type: "image/png",
    });
  });

  it("rejects empty or excessive selections instead of copying a partial pack", async () => {
    await expect(joinImagePackPages([], signal())).rejects.toThrow("请选择");
    await expect(
      joinImagePackPages(
        Array.from({ length: 10 }, () => png("page")),
        signal()
      )
    ).rejects.toThrow("请选择");
  });

  it("does not return a partial long image after a decode failure", async () => {
    const { decode, canvas, bitmaps } = canvasEnvironment();
    decode.mockRejectedValueOnce(new Error("decode failed"));
    await expect(
      joinImagePackPages([png("bad"), png("page")], signal())
    ).rejects.toThrow("decode failed");
    expect(bitmaps).toHaveLength(0);
    expect(canvas.toBlob).not.toHaveBeenCalled();
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it("cancels before copying when the panel closes during bitmap decoding", async () => {
    const { decode, draw, canvas } = canvasEnvironment();
    const controller = new AbortController();
    const bitmap = { source: png("page"), close: vi.fn() };
    decode.mockImplementationOnce(async () => {
      controller.abort();
      return bitmap;
    });
    await expect(
      joinImagePackPages([png("a"), png("b")], controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(draw).not.toHaveBeenCalled();
    expect(canvas.toBlob).not.toHaveBeenCalled();
  });

  it("reports encoding failure instead of a successful copy", async () => {
    const { canvas } = canvasEnvironment();
    canvas.toBlob.mockImplementationOnce(callback => callback(null));
    await expect(
      joinImagePackPages([png("a"), png("b")], signal())
    ).rejects.toThrow("长图生成失败");
    expect(canvas.width).toBe(0);
  });

  it("starts one clipboard item in the click gesture and resolves all selected pages into it", async () => {
    const { result } = canvasEnvironment();
    const write = vi.fn(async (_items: unknown[]) => {});
    let data: Record<string, Promise<Blob>> = {};
    vi.stubGlobal("navigator", { clipboard: { write } });
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(value: Record<string, Promise<Blob>>) {
          data = value;
        }
      }
    );
    const copying = copyImagePackPages([png("a"), png("b")], signal());
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0][0]).toHaveLength(1);
    expect(await data["image/png"]).toBe(result);
    await copying;
  });

  it("offers a clear download fallback when image copying is unavailable", () => {
    vi.stubGlobal("navigator", { clipboard: {} });
    expect(() => copyImagePackPages([png("a")], signal())).toThrow(
      "请下载所选图片"
    );
  });
});
