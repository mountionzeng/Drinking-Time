import { readChapterMedia } from "../chapterMediaStore";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { TRPCError } from "@trpc/server";
import {
  ChapterPackageError,
  parseChapterPackage,
  chapterPackageAssetId,
  fromChapterPackage,
  toChapterPackage,
  type ChapterPackage,
  type PackageImageInfo,
  type WebChapterResult,
} from "../../shared/chapterPackage";
import type { ChapterContent } from "../repositories/chapters";
import {
  readChapterLayout,
  type StoredChapterBlocks,
} from "../../shared/chapterStore";
import type { StoryChapter } from "../../drizzle/schema";
import { storageGet, storagePut } from "../storage";
import { localImageDir } from "./imageGen";
import type { ModuleDocument } from "../../shared/sharedLayout";
import { CHAPTER_PACKAGE_LIMITS } from "../../shared/chapterPackage";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const newPackageId = () => `cp_${randomBytes(12).toString("hex")}`;

/**
 * Stored chapter -> a package. Image keys stay storage keys; bytes travel separately.
 * Images the chapter has no stored facts for (for example pictures that only live in
 * the editor's story library) cannot be packed: they are left out and counted.
 */
export function packChapter(
  chapter: StoryChapter,
  meta: {
    packageId: string;
    displayName: string;
    storyTitle: string;
    lineage?: { rootPackageId: string; parentPackageId: string | null };
  },
  /** Facts for every image that can be packed; defaults to what the chapter stored. */
  images: Record<string, PackageImageInfo> = chapter.blocks.images
) {
  const stored = chapter.blocks;
  const known = (key: string | null | undefined): key is string =>
    Boolean(key && images[key]);
  let droppedImages = 0;
  const rendered = readChapterLayout(chapter.title, stored, chapter.layout);
  const layout = rendered
    ? {
        ...rendered,
        pages: rendered.pages.map(page => ({
          ...page,
          modules: page.modules.filter(module => {
            if (module.kind !== "image" || known(module.imageUrl)) return true;
            droppedImages++;
            return false;
          }),
        })),
      }
    : null;
  const illustrations = stored.illustrations.filter(item => {
    if (known(item.key)) return true;
    droppedImages++;
    return false;
  });
  const coverKey = known(stored.coverKey) ? stored.coverKey : null;
  const bodyTextureKey = known(stored.bodyTextureKey)
    ? stored.bodyTextureKey
    : null;
  if (stored.coverKey && !coverKey) droppedImages++;
  if (stored.bodyTextureKey && !bodyTextureKey) droppedImages++;
  // Use the format converter only for reading order. The stored binding is
  // authoritative even when a user moves or deletes a paragraph module.
  const packed = toChapterPackage(
    {
      chapterId: stored.sourceChapterId ?? `chapter-${chapter.id}`,
      title: chapter.title,
      body: stored.body,
      containsAiText: stored.containsAiText,
      coverKey,
      bodyTextureKey,
      illustrations,
    },
    images,
    {
      packageId: meta.packageId,
      createdAt: new Date().toISOString(),
      displayName: meta.displayName.slice(0, 40),
      storyTitle: meta.storyTitle.slice(0, 200),
      ...(meta.lineage || stored.lineage
        ? { lineage: meta.lineage ?? stored.lineage }
        : {}),
    }
  );
  const output = packed.package.chapters[0];
  let textIndex = 0;
  const imageBlocks = [...illustrations];
  for (const block of output.blocks) {
    if (block.type === "text")
      block.blockId = stored.blockIds[textIndex++] ?? block.blockId;
    else {
      const at = imageBlocks.findIndex(
        image => image.key === packed.assetKeys[block.assetId]
      );
      const original = at < 0 ? undefined : imageBlocks.splice(at, 1)[0];
      block.blockId = original?.blockId ?? block.blockId;
      if (original?.caption !== undefined) block.caption = original.caption;
    }
  }
  const useImage = (key: string) => {
    const assetId = chapterPackageAssetId(key);
    packed.assetKeys[assetId] = key;
    if (!packed.package.assets.some(asset => asset.assetId === assetId))
      packed.package.assets.push({ assetId, ...images[key] });
    return assetId;
  };
  if (layout && chapter.layout) {
    output.layout = {
      canvas: { width: 900, height: 1200 },
      ...(layout.flowVersion ? { flowVersion: layout.flowVersion } : {}),
      settings: {
        fontId: stored.settings?.fontId ?? "noto-serif-sc",
        style: stored.settings?.style ?? "sage",
        texture: stored.settings?.texture ?? "paper",
        textureSeed: stored.settings?.textureSeed ?? 0,
        includeCover: Boolean(coverKey),
        bodyTextureAssetId: bodyTextureKey ? useImage(bodyTextureKey) : null,
      },
      pages: chapter.layout.pages.map(page => ({
        label: page.label,
        modules: page.modules.flatMap(
          (
            module
          ): import("../../shared/chapterPackage").ChapterPackageLayoutModule[] => {
            if (module.kind === "image") {
              if (!known(module.imageUrl)) return [];
              const { imageUrl, ...style } = module;
              return [{ ...style, assetId: useImage(imageUrl) }];
            }
            const { bind, ...style } = module;
            if (bind === "title")
              return [{ ...style, bind: { chapterTitle: true } }];
            const ids = (Array.isArray(bind) ? bind : [bind]).filter(id =>
              stored.blockIds.includes(id)
            );
            return ids.map((id, index) => ({
              ...style,
              id: index ? `${style.id}~line-${index}` : style.id,
              bind: { blockId: id },
              rect: {
                ...style.rect,
                y: style.rect.y + (style.rect.height * index) / ids.length,
                height: style.rect.height / ids.length,
              },
              contentHeight: style.contentHeight / ids.length,
            }));
          }
        ),
      })),
    };
  }
  packed.package = parseChapterPackage(packed.package);

  return { ...packed, droppedImages };
}

export function sha256Bytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export type ImageFile = { assetId: string; base64: string };

/** Verify uploaded bytes against the package's declared facts, then store by content hash. */
export async function storeImages(
  userId: number,
  pkg: ChapterPackage,
  files: ImageFile[]
): Promise<Map<string, string>> {
  const byId = new Map(files.map(file => [file.assetId, file]));
  const keys = new Map<string, string>();
  for (const asset of pkg.assets) {
    const file = byId.get(asset.assetId);
    if (!file) continue;
    const bytes = Buffer.from(file.base64, "base64");
    if (bytes.length !== asset.bytes || sha256Bytes(bytes) !== asset.sha256)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "图片内容和章节包里的说明不一致",
      });
    const key = `chapters/${userId}/${asset.sha256}.${EXT[asset.mime] ?? "bin"}`;
    await storagePut(key, bytes, asset.mime);
    keys.set(asset.assetId, key);
  }
  return keys;
}

/** Reads the stored bytes of every package asset; an asset whose bytes do not match is left out. */
export async function loadImageFiles(
  pkg: ChapterPackage,
  assetKeys: Record<string, string>,
  /** Bytes already read from the local library, by image key. */
  local: Map<string, Buffer> = new Map()
): Promise<{ files: ImageFile[]; missing: number }> {
  const files: ImageFile[] = [];
  let missing = 0;
  for (const asset of pkg.assets) {
    try {
      const key = assetKeys[asset.assetId];
      let bytes = local.get(key) ?? await readChapterMedia(key) ?? undefined;
      if (!bytes) {
        const response = await fetch((await storageGet(key)).url, {
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error("download failed");
        bytes = Buffer.from(await response.arrayBuffer());
      }
      if (bytes.length !== asset.bytes || sha256Bytes(bytes) !== asset.sha256)
        throw new Error("content mismatch");
      files.push({ assetId: asset.assetId, base64: bytes.toString("base64") });
    } catch {
      missing++;
    }
  }
  return { files, missing };
}

/** Fresh download urls for the stored keys; nothing signed is persisted. */
export async function imageUrls(
  keys: string[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of new Set(keys)) out[key] = (await storageGet(key)).url;
  return out;
}

export function chapterKeys(
  blocks: StoredChapterBlocks,
  layout: ModuleDocument | null = null
): string[] {
  return [
    ...(blocks.coverKey ? [blocks.coverKey] : []),
    ...(blocks.bodyTextureKey ? [blocks.bodyTextureKey] : []),
    ...blocks.illustrations.map(item => item.key),
    ...layoutImageKeys(layout),
  ];
}

export function layoutImageKeys(layout: ModuleDocument | null): string[] {
  return (layout?.pages ?? []).flatMap(page =>
    page.modules.flatMap(module =>
      module.kind === "image" ? [module.imageUrl] : []
    )
  );
}

/** Keys that live in object storage (as opposed to the editor's own image urls). */
export const isStoredImageKey = (key: string) => key.startsWith("chapters/");

const LOCAL_IMAGE =
  /\/api\/images\/([a-zA-Z0-9_-]+\.(?:png|jpe?g|webp))(?:[?#].*)?$/;
const FORMAT_MIME: Record<string, "image/jpeg" | "image/png" | "image/webp"> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * Facts and bytes for images the chapter only references by the editor's own
 * url (`/api/images/<file>`, served from the local image library). Oversized
 * images are re-encoded to WebP. Only files in the image library are read, and
 * only by a validated file name. Anything unreadable, or beyond the package
 * limits, is left out and counted in `dropped`.
 */
export async function resolveExportImages(
  keys: string[],
  known: Record<string, PackageImageInfo>,
  allowed: ReadonlySet<string>
): Promise<{
  facts: Record<string, PackageImageInfo>;
  bytes: Map<string, Buffer>;
  dropped: number;
}> {
  const L = CHAPTER_PACKAGE_LIMITS;
  const facts: Record<string, PackageImageInfo> = {};
  const bytes = new Map<string, Buffer>();
  let dropped = 0;
  const referenced = [...new Set(keys)].filter(key => known[key]);
  let total = referenced.reduce((sum, key) => sum + known[key].bytes, 0);
  let count = referenced.length;
  for (const key of new Set(keys)) {
    if (known[key]) continue;
    const match = LOCAL_IMAGE.exec(key);
    if (!match || !allowed.has(key) || count >= L.images) {
      dropped++;
      continue;
    }
    try {
      let data: Buffer = fs.readFileSync(path.join(localImageDir(), match[1]));
      let meta = await sharp(data).metadata();
      let mime = meta.format ? FORMAT_MIME[meta.format] : undefined;
      if (!mime || !meta.width || !meta.height)
        throw new Error("unsupported image");
      if (
        data.length > L.imageBytes ||
        meta.width > 2400 ||
        meta.height > 2400
      ) {
        data = await sharp(data)
          .rotate()
          .resize({
            width: 2400,
            height: 2400,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 85 })
          .toBuffer();
        meta = await sharp(data).metadata();
        mime = "image/webp";
      }
      if (data.length > L.imageBytes || total + data.length > L.totalImageBytes)
        throw new Error("over limit");
      facts[key] = {
        mime,
        bytes: data.length,
        sha256: sha256Bytes(data),
        width: meta.width!,
        height: meta.height!,
        aiGenerated: true,
      };
      bytes.set(key, data);
      total += data.length;
      count++;
    } catch {
      dropped++;
    }
  }
  return { facts, bytes, dropped };
}

/** A package chapter -> stored content. Images without uploaded bytes are kept out and reported. */
export function unpackChapter(
  input: unknown,
  keyOf: Map<string, string>,
  chapterId?: string
): {
  content: ChapterContent;
  title: string;
  result: WebChapterResult;
  missingImages: number;
} {
  let result: WebChapterResult;
  try {
    result = fromChapterPackage(input, {
      chapterId,
      resolveAssetKey: assetId => keyOf.get(assetId) ?? `missing:${assetId}`,
    });
  } catch (error) {
    if (error instanceof ChapterPackageError)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `章节包无法使用：${error.message}`,
      });
    throw error;
  }
  const isMissing = (key: string | null) =>
    key !== null && key.startsWith("missing:");
  const missing = new Set<string>();
  const note = (key: string | null) => {
    if (isMissing(key)) missing.add(key!);
  };
  note(result.coverKey);
  note(result.bodyTextureKey);
  result.illustrations.forEach(item => note(item.key));
  const images: Record<string, PackageImageInfo> = {};
  for (const [key, info] of Object.entries(result.images))
    if (!isMissing(key)) images[key] = info;
  const keep = (key: string | null) => (key && !isMissing(key) ? key : null);
  const pkg = parseChapterPackage(input);
  const source = pkg.chapters.find(
    item => item.chapterId === result.chapterId
  )!;
  const blocks: StoredChapterBlocks = {
    body: result.body,
    blockIds: source.blocks
      .filter(block => block.type === "text")
      .map(block => block.blockId),
    containsAiText: result.containsAiText,
    settings: result.settings,
    coverKey: keep(result.coverKey),
    bodyTextureKey: keep(result.bodyTextureKey),
    images,
    illustrations: result.illustrations
      .map((item, index) => {
        const original = source.blocks.filter(block => block.type === "image")[
          index
        ];
        return {
          ...item,
          blockId: original.blockId,
          ...(original.caption !== undefined
            ? { caption: original.caption }
            : {}),
        };
      })
      .filter(item => !isMissing(item.key)),
    sourceChapterId: source.chapterId,
    lineage: {
      rootPackageId: pkg.lineage.rootPackageId,
      parentPackageId: pkg.packageId,
    },
  };
  const storedLayout = source.layout
    ? {
        version: 1 as const,
        ...(source.layout.flowVersion
          ? { flowVersion: source.layout.flowVersion }
          : {}),
        pages: source.layout.pages.map(page => ({
          label: page.label,
          modules: page.modules.flatMap(
            (
              module
            ): import("../../shared/chapterStore").StoredChapterLayout["pages"][number]["modules"] => {
              if (module.kind === "image") {
                const key = keyOf.get(module.assetId);
                if (!key) {
                  missing.add(`missing:${module.assetId}`);
                  return [];
                }
                const { assetId: _id, ...style } = module;
                return [{ ...style, imageUrl: key }];
              }
              const { bind, ...style } = module;
              return [
                {
                  ...style,
                  bind: "chapterTitle" in bind ? "title" : bind.blockId,
                },
              ];
            }
          ),
        })),
      }
    : null;
  return {
    title: result.title,
    result,
    missingImages: missing.size,
    content: {
      title: result.title.trim().slice(0, 200) || "未命名章节",
      layout: storedLayout,
      blocks,
    },
  };
}

/** Decode raster pixels and strip metadata before persisting a local editor image. */
export async function storeChapterLocalImage(userId: number, base64: string) {
  const raw = Buffer.from(base64, "base64");
  if (raw.length > CHAPTER_PACKAGE_LIMITS.imageBytes) throw new Error("图片超过 2 MB");
  const decoder = sharp(raw, { limitInputPixels: 24_000_000 });
  const meta = await decoder.metadata();
  if (!["png", "jpeg", "webp"].includes(meta.format || "")) throw new Error("不支持的图片格式");
  const { data, info } = await decoder.rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer({ resolveWithObject: true });
  if (data.length > CHAPTER_PACKAGE_LIMITS.imageBytes) throw new Error("图片压缩后仍超过 2 MB");
  const hash = sha256Bytes(data);
  const key = `chapters/${userId}/${hash}.webp`;
  await storagePut(key, data, "image/webp");
  return { key, facts: { mime: "image/webp" as const, bytes: data.length, sha256: hash, width: info.width, height: info.height, aiGenerated: false } };
}
