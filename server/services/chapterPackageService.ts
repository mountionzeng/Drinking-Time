import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  ChapterPackageError,
  fromChapterPackage,
  toChapterPackage,
  type ChapterPackage,
  type PackageImageInfo,
  type WebChapterResult,
} from "../../shared/chapterPackage";
import type { ChapterContent } from "../repositories/chapters";
import type { StoredChapterBlocks } from "../../shared/chapterStore";
import type { StoryChapter } from "../../drizzle/schema";
import { storageGet, storagePut } from "../storage";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const newPackageId = () => `cp_${randomBytes(12).toString("hex")}`;

/** Stored chapter -> a package. Image keys stay storage keys; bytes travel separately. */
export function packChapter(
  chapter: StoryChapter,
  meta: { packageId: string; displayName: string; storyTitle: string; lineage?: { rootPackageId: string; parentPackageId: string | null } }
) {
  const stored = chapter.blocks;
  return toChapterPackage(
    {
      chapterId: `chapter-${chapter.id}`,
      title: chapter.title,
      body: stored.body,
      containsAiText: stored.containsAiText,
      settings: stored.settings ?? undefined,
      coverKey: stored.coverKey,
      bodyTextureKey: stored.bodyTextureKey,
      illustrations: stored.illustrations,
      modules: chapter.layout,
    },
    stored.images,
    {
      packageId: meta.packageId,
      createdAt: new Date().toISOString().replace(/\.\d+Z$/, ".000Z"),
      displayName: meta.displayName.slice(0, 40),
      storyTitle: meta.storyTitle.slice(0, 200),
      ...(meta.lineage ? { lineage: meta.lineage } : {}),
    },
    { blockIds: stored.blockIds }
  );
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
      throw new TRPCError({ code: "BAD_REQUEST", message: "图片内容和章节包里的说明不一致" });
    const key = `chapters/${userId}/${asset.sha256}.${EXT[asset.mime] ?? "bin"}`;
    await storagePut(key, bytes, asset.mime);
    keys.set(asset.assetId, key);
  }
  return keys;
}

/** Fresh download urls for the stored keys; nothing signed is persisted. */
export async function imageUrls(keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of new Set(keys)) out[key] = (await storageGet(key)).url;
  return out;
}

export function chapterKeys(blocks: StoredChapterBlocks): string[] {
  return [
    ...(blocks.coverKey ? [blocks.coverKey] : []),
    ...(blocks.bodyTextureKey ? [blocks.bodyTextureKey] : []),
    ...blocks.illustrations.map(item => item.key),
  ];
}

/** A package chapter -> stored content. Images without uploaded bytes are kept out and reported. */
export function unpackChapter(
  input: unknown,
  keyOf: Map<string, string>
): { content: ChapterContent; title: string; result: WebChapterResult; missingImages: number } {
  let result: WebChapterResult;
  try {
    result = fromChapterPackage(input, {
      resolveAssetKey: assetId => keyOf.get(assetId) ?? `missing:${assetId}`,
    });
  } catch (error) {
    if (error instanceof ChapterPackageError)
      throw new TRPCError({ code: "BAD_REQUEST", message: `章节包无法使用：${error.message}` });
    throw error;
  }
  const isMissing = (key: string | null) => key !== null && key.startsWith("missing:");
  const missing = new Set<string>();
  const note = (key: string | null) => { if (isMissing(key)) missing.add(key!); };
  note(result.coverKey);
  note(result.bodyTextureKey);
  result.illustrations.forEach(item => note(item.key));
  const images: Record<string, PackageImageInfo> = {};
  for (const [key, info] of Object.entries(result.images)) if (!isMissing(key)) images[key] = info;
  const keep = (key: string | null) => (key && !isMissing(key) ? key : null);
  const layout = result.modules
    ? {
        ...result.modules,
        pages: result.modules.pages.map(page => ({
          ...page,
          modules: page.modules.filter(
            module => module.kind !== "image" || !isMissing(module.imageUrl)
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
      layout,
      blocks: {
        body: result.body,
        blockIds: result.sidecar.blockIds,
        containsAiText: result.containsAiText,
        settings: result.settings,
        coverKey: keep(result.coverKey),
        bodyTextureKey: keep(result.bodyTextureKey),
        images,
        illustrations: result.illustrations.filter(item => !isMissing(item.key)),
      },
    },
  };
}
