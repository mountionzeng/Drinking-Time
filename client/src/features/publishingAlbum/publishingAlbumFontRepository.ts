import {
  installedPublishingAlbumFonts,
  publishingAlbumFontById,
  type PublishingAlbumFontManifestEntry,
} from "../../../../shared/publishingAlbumFonts";

const FONT_URLS: Readonly<Record<string, string>> = {
  "noto-sans-sc": new URL("../../assets/fonts/publishing-album/noto-sans-sc/NotoSansSC[wght].ttf", import.meta.url).href,
  "noto-serif-sc": new URL("../../assets/fonts/publishing-album/noto-serif-sc/NotoSerifSC[wght].ttf", import.meta.url).href,
  "zcool-xiaowei": new URL("../../assets/fonts/publishing-album/zcool-xiaowei/ZCOOLXiaoWei-Regular.ttf", import.meta.url).href,
  "ma-shan-zheng": new URL("../../assets/fonts/publishing-album/ma-shan-zheng/MaShanZheng-Regular.ttf", import.meta.url).href,
  "zhi-mang-xing": new URL("../../assets/fonts/publishing-album/zhi-mang-xing/ZhiMangXing-Regular.ttf", import.meta.url).href,
};

type FontFaceLike = { load(): Promise<FontFaceLike> };
type FontFaceConstructorLike = new (
  family: string,
  source: ArrayBuffer,
  descriptors?: { weight?: string }
) => FontFaceLike;

function uint16(view: DataView, offset: number): number {
  return view.getUint16(offset, false);
}

function uint32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

function cmapOffset(view: DataView): number {
  const tableCount = uint16(view, 4);
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16;
    const tag = String.fromCharCode(
      view.getUint8(record), view.getUint8(record + 1),
      view.getUint8(record + 2), view.getUint8(record + 3)
    );
    if (tag === "cmap") return uint32(view, record + 8);
  }
  throw new Error("字体缺少 cmap 字符映射表");
}

function cmapSubtables(view: DataView): number[] {
  const base = cmapOffset(view);
  const count = uint16(view, base + 2);
  const offsets: Array<{ offset: number; format: number; priority: number }> = [];
  for (let index = 0; index < count; index += 1) {
    const record = base + 4 + index * 8;
    const platform = uint16(view, record);
    const encoding = uint16(view, record + 2);
    const offset = base + uint32(view, record + 4);
    const format = uint16(view, offset);
    if (format !== 4 && format !== 12) continue;
    offsets.push({
      offset,
      format,
      priority: format === 12 ? 0 : platform === 3 && encoding === 10 ? 1 : 2,
    });
  }
  return offsets.sort((left, right) => left.priority - right.priority).map(item => item.offset);
}

function format12Supports(view: DataView, offset: number, codePoint: number): boolean {
  const groupCount = uint32(view, offset + 12);
  let low = 0;
  let high = groupCount - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const group = offset + 16 + middle * 12;
    const start = uint32(view, group);
    const end = uint32(view, group + 4);
    if (codePoint < start) high = middle - 1;
    else if (codePoint > end) low = middle + 1;
    else return uint32(view, group + 8) + codePoint - start !== 0;
  }
  return false;
}

function format4Supports(view: DataView, offset: number, codePoint: number): boolean {
  if (codePoint > 0xffff) return false;
  const segmentCount = uint16(view, offset + 6) / 2;
  const endCodes = offset + 14;
  const startCodes = endCodes + segmentCount * 2 + 2;
  const deltas = startCodes + segmentCount * 2;
  const rangeOffsets = deltas + segmentCount * 2;
  for (let index = 0; index < segmentCount; index += 1) {
    const end = uint16(view, endCodes + index * 2);
    if (codePoint > end) continue;
    const start = uint16(view, startCodes + index * 2);
    if (codePoint < start) return false;
    const rangeOffsetAddress = rangeOffsets + index * 2;
    const rangeOffset = uint16(view, rangeOffsetAddress);
    if (rangeOffset === 0) {
      return (codePoint + view.getInt16(deltas + index * 2, false)) & 0xffff ? true : false;
    }
    const glyphAddress = rangeOffsetAddress + rangeOffset + (codePoint - start) * 2;
    if (glyphAddress + 2 > view.byteLength) return false;
    const glyph = uint16(view, glyphAddress);
    return glyph !== 0;
  }
  return false;
}

export function fontBufferSupportsCodePoint(buffer: ArrayBuffer, codePoint: number): boolean {
  const view = new DataView(buffer);
  return cmapSubtables(view).some(offset => {
    const format = uint16(view, offset);
    return format === 12
      ? format12Supports(view, offset, codePoint)
      : format4Supports(view, offset, codePoint);
  });
}

export function fontBufferMissingCharacters(buffer: ArrayBuffer, text: string): string[] {
  return Array.from(new Set(Array.from(text))).filter(character =>
    !fontBufferSupportsCodePoint(buffer, character.codePointAt(0) ?? 0)
  );
}

export class PublishingAlbumFontRepository {
  private readonly buffers = new Map<string, Promise<ArrayBuffer>>();
  private readonly loaded = new Map<string, Promise<void>>();

  constructor(private readonly dependencies: {
    fetcher?: typeof fetch;
    FontFaceCtor?: FontFaceConstructorLike;
    fontSet?: { add(face: FontFaceLike): void };
  } = {}) {}

  list(): PublishingAlbumFontManifestEntry[] {
    return installedPublishingAlbumFonts();
  }

  private entry(fontId: string): PublishingAlbumFontManifestEntry {
    const font = publishingAlbumFontById(fontId);
    if (!font?.installed || !font.filePath || !FONT_URLS[fontId]) {
      throw new Error("字体未安装或不允许用于画册");
    }
    return font;
  }

  async buffer(fontId: string): Promise<ArrayBuffer> {
    this.entry(fontId);
    let request = this.buffers.get(fontId);
    if (!request) {
      const fetcher = this.dependencies.fetcher ?? globalThis.fetch;
      request = fetcher(FONT_URLS[fontId]!).then(async response => {
        if (!response.ok) throw new Error(`字体 ${fontId} 加载失败（${response.status}）`);
        return response.arrayBuffer();
      });
      this.buffers.set(fontId, request);
    }
    return request;
  }

  async missingCharacters(fontId: string, text: string): Promise<string[]> {
    return fontBufferMissingCharacters(await this.buffer(fontId), text);
  }

  async load(fontId: string): Promise<void> {
    const font = this.entry(fontId);
    let request = this.loaded.get(fontId);
    if (!request) {
      request = (async () => {
        const FontFaceCtor = this.dependencies.FontFaceCtor ?? globalThis.FontFace as unknown as FontFaceConstructorLike;
        const fontSet = this.dependencies.fontSet ?? document.fonts as unknown as { add(face: FontFaceLike): void };
        const face = new FontFaceCtor(font.family, await this.buffer(fontId), { weight: font.weights });
        fontSet.add(await face.load());
      })();
      this.loaded.set(fontId, request);
    }
    await request;
  }

  async loadSelectedWithFallback(fontId: string, text: string): Promise<{
    selectedFontId: string;
    fallbackFontId: "noto-sans-sc" | null;
    missingCharacters: string[];
  }> {
    await this.load(fontId);
    const missingCharacters = await this.missingCharacters(fontId, text);
    const fallbackFontId = missingCharacters.length > 0 && fontId !== "noto-sans-sc"
      ? "noto-sans-sc" as const
      : null;
    if (fallbackFontId) await this.load(fallbackFontId);
    return { selectedFontId: fontId, fallbackFontId, missingCharacters };
  }
}
