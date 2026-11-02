import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import sharp from "sharp";
import { z } from "zod";
import { bookImageText } from "../../shared/bookImageBlock";
import {
  validWritingStyle,
  type BookWritingStyle,
} from "../../shared/bookWritingStyle";
import { chapterPackageLines } from "../../shared/chapterPackage";
import {
  wechatBookSnapshotSchema,
  wechatCatalogSchema,
  type WechatBookSnapshot,
  type WechatStoryRef,
} from "../../shared/wechatBookImport";
import {
  commitChapterImport,
  findImportReceipt,
  type ChapterContent,
} from "../repositories/chapters";
import { wechatImportSubject } from "../repositories/wechatBookImport";
import { putChapterMedia } from "../chapterMediaStore";
import { authorityRequest } from "./shiguangStoryAuthorityClient";

const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export const importRequestId = (subject: string, ref: WechatStoryRef) =>
  hash(
    JSON.stringify([
      "wechat-book-v1",
      subject,
      ref.storyId,
      ref.revisionId,
      ref.version,
    ])
  );
export const wechatImportEnabled = () =>
  process.env.WECHAT_BOOK_IMPORT_ENABLED === "true" &&
  process.env.CHAPTER_PACKAGE_ENABLED === "true";
const mediaUrl = (key: string) =>
  `/api/wechat-import/media/${key.split("/").at(-1)}`;
type SavedImage = {
  key: string;
  mime: "image/png" | "image/jpeg" | "image/webp";
  bytes: number;
  sha256: string;
  width: number;
  height: number;
  aiGenerated: boolean;
};

/** One web manuscript containing heading modules, never one editing workspace per chapter. */
export function wechatBookContent(
  book: WechatBookSnapshot,
  images: Map<string, SavedImage>,
  now = new Date()
): ChapterContent {
  const texts: string[] = [],
    style: BookWritingStyle = [],
    modules: NonNullable<ChapterContent["blocks"]["wechatImport"]>["modules"] =
      [];
  let page = 0,
    y = 48;
  const add = (
    text: string,
    id: string,
    parentId: string | null,
    format: "heading1" | "text",
    fontSize = 24
  ) => {
    text = text.replace(/\r\n?/g, "\n");
    const height = Math.min(
      1000,
      Math.max(
        60,
        text
          .split("\n")
          .reduce(
            (n, l) =>
              n +
              Math.max(
                1,
                Math.ceil(l.length / Math.max(10, Math.floor(780 / fontSize)))
              ),
            0
          ) *
          fontSize *
          1.6
      )
    );
    if (y + height > 1152) {
      page++;
      y = 48;
    }
    style.push({
      id,
      parentId,
      format,
      collapsed: false,
      lineCount: text.split("\n").length,
      book: { page, fontSize, rect: { x: 36, y, width: 828, height } },
    });
    y += height + 24;
    texts.push(text);
  };
  const cover = book.cover && images.get(book.cover.ref);
  if (cover) add(bookImageText(mediaUrl(cover.key)), "wx-cover", null, "text");
  for (const [ci, chapter] of book.chapters.entries()) {
    const heading = `wx-${hash(chapter.id).slice(0, 24)}`;
    // An untitled chapter remains an ordered container. An entirely unchaptered
    // manuscript is represented by zero chapters, not by a fabricated article.
    add(chapter.title || `未命名章 ${ci + 1}`, heading, null, "heading1", 36);
    modules.push({ id: heading, chapterId: chapter.id, sourceIds: [] });
    for (const block of chapter.content) {
      const id = `wx-${hash(`${chapter.id}:${block.id}`).slice(0, 24)}`;
      const photo = block.photo && images.get(block.photo.ref);
      add(
        block.text ??
          (photo
            ? bookImageText(mediaUrl(photo.key))
            : "〔这张图片未能导入，请在微信原稿查看〕"),
        id,
        heading,
        "text",
        block.fontSize
      );
      modules.push({
        id,
        chapterId: chapter.id,
        sourceBlockId: block.id,
        sourceIds: block.sourceIds,
        ...(block.photo ? { photoRef: block.photo.ref } : {}),
      });
    }
  }
  if (!texts.length) add("", "wx-empty", null, "text");
  const body = texts.join("\n");
  if (!validWritingStyle(body, style) || body.length > 250000)
    throw new Error("wechat_import_document_invalid");
  return {
    title: book.title,
    layout: null,
    blocks: {
      body,
      writingStyle: style,
      blockIds: chapterPackageLines(body).map(
        (_, i) => `block-${hash(`wx:${i}:${body}`)}`
      ),
      containsAiText: book.containsAiText,
      settings: null,
      coverKey: cover?.key ?? null,
      bodyTextureKey: null,
      images: Object.fromEntries(
        [...images.values()].map(({ key, ...info }) => [key, info])
      ),
      illustrations: [],
      attribution: {
        editorName: book.editorName || "微信原稿",
        sourceName: book.receivedFromName || "微信 · 拾光家忆",
        action: "received",
      },
      wechatImport: {
        storyId: book.storyId,
        revisionId: book.revisionId,
        version: book.version,
        importedAt: now.toISOString(),
        editorName: book.editorName,
        receivedFromName: book.receivedFromName,
        changeSummary: book.changeSummary,
        modules,
        warnings: book.warnings,
      },
    },
  };
}

async function readAuthority(subject: string, input: Record<string, unknown>) {
  return authorityRequest(
    "/v1/web-import",
    { grantId: `desktop-grant-${hash(`web-import:${subject}`)}`, ...input },
    {
      enabled: wechatImportEnabled(),
      maxResponseBytes: input.operation === "media" ? 2900000 : 600000,
    }
  );
}

export type WechatImportDependencies = {
  subject: typeof wechatImportSubject;
  request: typeof readAuthority;
  receipt: typeof findImportReceipt;
  commit: typeof commitChapterImport;
  storeImage: (userId: number, base64: string) => Promise<SavedImage>;
};
async function storeImage(userId: number, base64: string): Promise<SavedImage> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 2800000)
    throw new Error("wechat_import_media_invalid");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > 2 * 1024 * 1024)
    throw new Error("wechat_import_media_invalid");
  const metadata = await sharp(bytes, {
    limitInputPixels: 20_000_000,
  }).metadata();
  const ext = metadata.format;
  if (!["jpeg", "png", "webp"].includes(ext ?? "") || (metadata.pages ?? 1) > 1)
    throw new Error("wechat_import_media_invalid");
  const mime = `image/${ext}` as SavedImage["mime"],
    sha256 = hash(bytes),
    key = `chapters/${userId}/${sha256}.${ext === "jpeg" ? "jpg" : ext}`;
  await putChapterMedia(key, bytes);
  return {
    key,
    mime,
    bytes: bytes.length,
    sha256,
    width: metadata.width!,
    height: metadata.height!,
    aiGenerated: false,
  };
}
const defaults: WechatImportDependencies = {
  subject: wechatImportSubject,
  request: readAuthority,
  receipt: findImportReceipt,
  commit: commitChapterImport,
  storeImage,
};
export function createWechatBookImportService(
  overrides: Partial<WechatImportDependencies> = {}
) {
  const deps = { ...defaults, ...overrides };
  async function subject(userId: number) {
    const value = await deps.subject(userId);
    if (!value)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "请先使用微信登录，再选择微信里的故事",
      });
    return value;
  }
  return {
    async catalog(userId: number, cursor = 0) {
      const owner = await subject(userId),
        page = wechatCatalogSchema.parse(
          await deps.request(owner, { operation: "list", cursor })
        );
      return {
        ...page,
        stories: await Promise.all(
          page.stories.map(async story => {
            const prior = await deps.receipt(
              userId,
              importRequestId(owner, story)
            );
            return { ...story, importedStoryId: prior?.storyId ?? null };
          })
        ),
      };
    },
    async importBook(userId: number, ref: WechatStoryRef) {
      const owner = await subject(userId),
        requestId = importRequestId(owner, ref);
      const prior = await deps.receipt(userId, requestId);
      // Receipt survives editing, deletion and browser retries; never recreate a deleted copy.
      if (prior)
        return {
          storyId: prior.storyId,
          repeated: true,
          warnings: [] as string[],
        };
      const book = wechatBookSnapshotSchema.parse(
        await deps.request(owner, { operation: "read", ...ref })
      );
      if (
        book.storyId !== ref.storyId ||
        book.revisionId !== ref.revisionId ||
        book.version !== ref.version
      )
        throw new Error("story_version_conflict");
      const refs = [
        ...new Map(
          [
            ...(book.cover ? [book.cover] : []),
            ...book.chapters.flatMap(c =>
              c.content.flatMap(b => (b.photo ? [b.photo] : []))
            ),
          ].map(p => [p.ref, p])
        ).values(),
      ];
      if (refs.length > 100)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "这份书稿图片超过100张，请先在微信拆分后导入",
        });
      const images = new Map<string, SavedImage>();
      for (const image of refs.filter(p => p.available)) {
        const result = z
          .object({ base64: z.string().min(1).max(2800000) })
          .strict()
          .parse(
            await deps.request(owner, {
              operation: "media",
              ...ref,
              mediaRef: image.ref,
            })
          );
        images.set(image.ref, {
          ...(await deps.storeImage(userId, result.base64)),
          aiGenerated:
            image.ref.startsWith("photo-ai-") || image.ref.startsWith("cover:"),
        });
      }
      // Recheck permission/revision after all media I/O, before committing a copy.
      const current = wechatBookSnapshotSchema.parse(
        await deps.request(owner, { operation: "read", ...ref })
      );
      if (JSON.stringify(current) !== JSON.stringify(book))
        throw new Error("story_version_conflict");
      const content = wechatBookContent(book, images);
      const result = await deps.commit({
        userId,
        requestId,
        requestHash: hash(
          JSON.stringify([owner, ref.storyId, ref.revisionId, ref.version])
        ),
        packageId: requestId,
        title: book.title,
        senderName: book.editorName || "微信原稿",
        contents: [content],
      });
      return {
        storyId: result.storyId,
        repeated: result.repeated,
        warnings: book.warnings,
      };
    },
  };
}
export const wechatBookImportService = createWechatBookImportService();
