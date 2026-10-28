import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadImageFiles,
  resolveExportImages,
  sha256Bytes,
  storeImages,
} from "./chapterPackageService";
import { toChapterPackage } from "../../shared/chapterPackage";

let directory = "";
const storedMedia = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("../chapterMediaStore", () => ({ readChapterMedia: vi.fn(async (key: string) => storedMedia.get(key) ?? null) }));
vi.mock("./imageGen", () => ({ localImageDir: () => directory }));
vi.mock("../storage", () => ({
  storagePut: vi.fn(async (key: string) => ({ key })),
  storageGet: vi.fn(),
}));
beforeEach(() => {
  storedMedia.clear();
  directory = mkdtempSync(path.join(tmpdir(), "chapter-images-"));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("chapter package image bytes", () => {
  it("reads only owned library images, keeps the AI flag and carries bytes beside the package", async () => {
    const bytes = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    writeFileSync(path.join(directory, "owned.png"), bytes);
    writeFileSync(path.join(directory, "foreign.png"), bytes);
    const url = "/api/images/owned.png";
    const extra = await resolveExportImages(
      [url, "/api/images/foreign.png"],
      {},
      new Set([url])
    );
    expect(Object.keys(extra.facts)).toEqual([url]);
    expect(extra.facts[url]).toMatchObject({
      aiGenerated: true,
      sha256: sha256Bytes(bytes),
    });
    expect(extra.dropped).toBe(1);
    const packed = toChapterPackage(
      {
        chapterId: "chapter-images",
        title: "图片",
        body: "正文",
        coverKey: url,
      },
      extra.facts,
      {
        packageId: "cp_images0000001",
        displayName: "本人",
        createdAt: new Date().toISOString(),
      }
    );
    const files = await loadImageFiles(
      packed.package,
      packed.assetKeys,
      extra.bytes
    );
    expect(files.missing).toBe(0);
    expect(Buffer.from(files.files[0].base64, "base64")).toEqual(bytes);
    expect(JSON.stringify(packed.package)).not.toContain("data:");
    const keys = await storeImages(7, packed.package, files.files);
    expect([...keys.values()][0]).toBe(`chapters/7/${sha256Bytes(bytes)}.png`);
    await expect(
      storeImages(7, packed.package, [{ ...files.files[0], base64: "AAAA" }])
    ).rejects.toThrow("不一致");
  });
  it("exports stored WebP as portable raster bytes with matching facts and preserves alpha", async () => {
    const original = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).webp().toBuffer();
    const key = "chapters/7/" + sha256Bytes(original) + ".webp";
    storedMedia.set(key, original);
    const known = { [key]: { mime: "image/webp" as const, bytes: original.length, sha256: sha256Bytes(original), width: 4, height: 4, aiGenerated: false } };
    const result = await resolveExportImages([key], known, new Set());
    expect(result.facts[key]).toMatchObject({ mime: "image/png", aiGenerated: false });
    const converted = result.bytes.get(key)!;
    expect(result.facts[key].sha256).toBe(sha256Bytes(converted));
    expect(result.facts[key].bytes).toBe(converted.length);
    expect((await sharp(converted).metadata()).hasAlpha).toBe(true);
    expect(storedMedia.get(key)).toEqual(original);
    expect(known[key].mime).toBe("image/webp");
  });
  it("resizes oversized generated images before describing their bytes", async () => {
    const bytes = await sharp({
      create: { width: 2500, height: 100, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    writeFileSync(path.join(directory, "large.png"), bytes);
    const key = "/api/images/large.png";
    const extra = await resolveExportImages([key], {}, new Set([key]));
    expect(extra.facts[key]).toMatchObject({
      mime: "image/jpeg",
      width: 2400,
      aiGenerated: true,
    });
    expect(extra.facts[key].bytes).toBe(extra.bytes.get(key)!.length);
  });
});
