import { listOwnChapterDeliveryHistory } from "../repositories/chapterDeliveries";
import { getUserById } from "../repositories/users";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { artworkAuthorName } from "../../shared/artworkShare";
import {
  chapterPackageBlockId,
  chapterPackageLines,
  safeParseChapterPackage,
} from "../../shared/chapterPackage";
import {
  CHAPTER_IMPORT_PER_HOUR,
  chapterEnabled,
  chapterLayoutProblem,
  chapterLayoutSchema,
  chapterTitleSchema,
  realignBlockIds,
  readChapterLayout,
  writeChapterLayout,
  draftFingerprint,
  type StoredChapterBlocks,
} from "../../shared/chapterStore";
import { consumePersistentRateLimit } from "../repositories/accounts";
import {
  deleteChapter,
  findImportReceipt,
  findOwnExport,
  getChapter,
  getReturnCandidate,
  insertChapter,
  commitChapterImport,
  listChapterVersions,
  listOwnChapterExports,
  listChapters,
  listReturnCandidates,
  recordChapterExport,
  reorderChapters,
  saveChapterContent,
  setCandidateStatus,
} from "../repositories/chapters";
import { getStoryGeneratedImages } from "../repositories/images";
import { getStoryById } from "../repositories/stories";
import {
  chapterKeys,
  imageUrls,
  isStoredImageKey,
  layoutImageKeys,
  loadImageFiles,
  newPackageId,
  packChapter,
  resolveExportImages,
  storeImages,
  storeChapterLocalImage,
  unpackChapter,
} from "../services/chapterPackageService";

const storyInput = z.object({ storyId: z.number().int().positive() });
const chapterInput = z.object({ chapterId: z.number().int().positive() });
const MAX_BODY = 200_000;

function requireEnabled() {
  if (!chapterEnabled())
    throw new TRPCError({ code: "NOT_FOUND", message: "章节功能暂未开放" });
}
async function ownStory(storyId: number, userId: number) {
  const story = await getStoryById(storyId, userId);
  if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
  return story;
}
async function ownChapter(chapterId: number, userId: number) {
  const chapter = await getChapter(chapterId, userId);
  if (!chapter)
    throw new TRPCError({ code: "NOT_FOUND", message: "这一章不存在" });
  return chapter;
}
const view = (c: Awaited<ReturnType<typeof ownChapter>>) => ({
  id: c.id,
  storyId: c.storyId,
  position: c.position,
  title: c.title,
  blocks: c.blocks,
  layout: readChapterLayout(c.title, c.blocks, c.layout),
  version: c.version,
  updatedAt: c.updatedAt,
});
const emptyBlocks = (body: string): StoredChapterBlocks => ({
  body,
  blockIds: chapterPackageLines(body).map(() =>
    chapterPackageBlockId(["web-line", randomUUID()])
  ),
  containsAiText: false,
  settings: null,
  coverKey: null,
  bodyTextureKey: null,
  images: {},
  illustrations: [],
});

export const chaptersRouter = router({
  /** The UI hides every chapter entry when this is false. */
  enabled: protectedProcedure.query(() => ({ enabled: chapterEnabled() })),

  list: protectedProcedure.input(storyInput).query(async ({ ctx, input }) => {
    requireEnabled();
    await ownStory(input.storyId, ctx.user.id);
    return (await listChapters(input.storyId, ctx.user.id)).map(view);
  }),

  /** One chapter plus fresh image urls; urls are never stored. */
  get: protectedProcedure.input(chapterInput).query(async ({ ctx, input }) => {
    requireEnabled();
    const chapter = await ownChapter(input.chapterId, ctx.user.id);
    return {
      chapter: view(chapter),
      imageUrls: await imageUrls(
        chapterKeys(
          chapter.blocks,
          readChapterLayout(chapter.title, chapter.blocks, chapter.layout)
        ).filter(isStoredImageKey)
      ),
    };
  }),

  create: protectedProcedure
    .input(
      storyInput.extend({
        title: chapterTitleSchema,
        body: z.string().max(MAX_BODY).default(""),
        draftSource: z.string().max(300).optional(),
        containsAiText: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireEnabled();
      await ownStory(input.storyId, ctx.user.id);
      return view(
        await insertChapter({
          storyId: input.storyId,
          userId: ctx.user.id,
          content: {
            title: input.title,
            blocks: {
              ...emptyBlocks(input.body),
              attribution: { editorName: artworkAuthorName(ctx.user.name), action: "created" },
              containsAiText: input.containsAiText,
              ...(input.draftSource
                ? {
                    draftMirror: {
                      source: input.draftSource,
                      fingerprint: draftFingerprint(input.title, input.body),
                    },
                  }
                : {}),
            },
            layout: null,
          },
        })
      );
    }),

  /** Edits one chapter. `expectedVersion` must match or the save is refused. */
  save: protectedProcedure
    .input(
      chapterInput.extend({
        expectedVersion: z.number().int().positive(),
        title: chapterTitleSchema.optional(),
        body: z.string().max(MAX_BODY).optional(),
        layout: chapterLayoutSchema.optional(),
        /** Look of the layout (font, paper style), kept with the chapter so it can be exported. */
        settings: z
          .object({
            fontId: z.string().max(80),
            style: z.string().max(40),
            texture: z.string().max(40),
            textureSeed: z.number().int(),
          })
          .nullable()
          .optional(),
        /** Background saves from the editor; they do not fill the version history. */
        localImages: z.array(z.object({ ref: z.string().regex(/^local-image:\d+$/), base64: z.string().max(2_800_000) })).max(12).optional(),
        autosave: z.boolean().optional(),
        mirrorFrom: z.string().max(300).optional(),
        media: z
          .object({
            coverKey: z.string().max(2000).nullable(),
            bodyTextureKey: z.string().max(2000).nullable(),
            illustrations: z
              .array(
                z.object({
                  key: z.string().max(2000),
                  after: z
                    .object({
                      text: z.string().max(4000),
                      occurrence: z.number().int().nonnegative(),
                      matches: z.number().int().nonnegative(),
                    })
                    .nullable(),
                  blockId: z.string().optional(),
                  caption: z.string().optional(),
                })
              )
              .max(12),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireEnabled();
      const problem = chapterLayoutProblem(input.layout ?? null);
      if (problem)
        throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      const chapter = await ownChapter(input.chapterId, ctx.user.id);
      if (chapter.version !== input.expectedVersion) throw new TRPCError({ code: "CONFLICT", message: "章节已有新版本，请刷新后重试" });
      const localFacts: StoredChapterBlocks["images"] = {};
      const localKeys = new Map<string, string>();
      const referenced = new Set([...layoutImageKeys(input.layout ?? null), ...(input.media ? chapterKeys({ ...chapter.blocks, ...input.media }) : [])]);
      if ((input.localImages ?? []).reduce((sum, image) => sum + image.base64.length, 0) > 8_000_000)
        throw new TRPCError({ code: "BAD_REQUEST", message: "本次图片总大小超过限制" });
      for (const image of input.localImages ?? []) {
        if (!referenced.has(image.ref) || localKeys.has(image.ref)) throw new TRPCError({ code: "BAD_REQUEST", message: "图片引用不一致" });
        const stored = await storeChapterLocalImage(ctx.user.id, image.base64);
        localKeys.set(image.ref, stored.key); localFacts[stored.key] = stored.facts;
      }
      const storedKey = (key: string) => localKeys.get(key) ?? key;
      if (input.layout) input.layout = { ...input.layout, pages: input.layout.pages.map(page => ({ ...page, modules: page.modules.map(module => module.kind === "image" ? { ...module, imageUrl: storedKey(module.imageUrl) } : module) })) };
      if (input.media) input.media = { ...input.media, coverKey: input.media.coverKey ? storedKey(input.media.coverKey) : null, bodyTextureKey: input.media.bodyTextureKey ? storedKey(input.media.bodyTextureKey) : null, illustrations: input.media.illustrations.map(image => ({ ...image, key: storedKey(image.key) })) };
      if (input.layout || input.media) {
        const keys = [
          ...layoutImageKeys(input.layout ?? null),
          ...(input.media
            ? chapterKeys({ ...chapter.blocks, ...input.media })
            : []),
        ];
        const unknown = keys.filter(key => !chapter.blocks.images[key] && !localFacts[key]);
        if (unknown.length) {
          const allowed = new Set(
            (await getStoryGeneratedImages(chapter.storyId, ctx.user.id)).map(
              image => image.imageUrl
            )
          );
          if (unknown.some(key => !allowed.has(key)))
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "排版含未归属当前故事的图片，请先导入图片",
            });
        }
      }
      if (
        input.mirrorFrom &&
        (chapter.blocks.draftMirror?.source !== input.mirrorFrom ||
          chapter.blocks.draftMirror.fingerprint !==
            draftFingerprint(chapter.title, chapter.blocks.body))
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "这一章已独立编辑，不能再随平台稿更新",
        });
      let title = input.title ?? chapter.title;
      let blocks = { ...chapter.blocks, images: { ...chapter.blocks.images, ...localFacts } };
      let layout = chapter.layout;
      if (input.body !== undefined) {
        blocks.blockIds = realignBlockIds(
          blocks.body,
          blocks.blockIds,
          input.body,
          () => chapterPackageBlockId(["web-new-line", randomUUID()])
        );
        blocks.body = input.body;
      }
      if (input.settings !== undefined) blocks.settings = input.settings;
      if (input.media) blocks = { ...blocks, ...input.media };
      if (input.layout !== undefined) {
        if (input.layout === null) layout = null;
        else {
          try {
            ({ title, blocks, layout } = writeChapterLayout(
              title,
              blocks,
              layout,
              input.layout,
              () => chapterPackageBlockId(["web-module", randomUUID()])
            ));
          } catch (error) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: error instanceof Error ? error.message : "排版无法保存",
            });
          }
        }
      }
      title = chapterTitleSchema.parse(title);
      if (title !== chapter.title || blocks.body !== chapter.blocks.body) {
        blocks.draftMirror = input.mirrorFrom
          ? {
              source: input.mirrorFrom,
              fingerprint: draftFingerprint(title, blocks.body),
            }
          : undefined;
      }

      const contentChanged = title !== chapter.title ||
        !isDeepStrictEqual(blocks, chapter.blocks) || !isDeepStrictEqual(layout, chapter.layout);
      if (contentChanged) blocks.attribution = {
        ...blocks.attribution, editorName: artworkAuthorName(ctx.user.name), action: "edited",
      };
      return view(
        await saveChapterContent({
          id: chapter.id,
          userId: ctx.user.id,
          expectedVersion: input.expectedVersion,
          reason: input.autosave ? "autosave" : "edit",
          content: { title, blocks, layout },
        })
      );
    }),

  reorder: protectedProcedure
    .input(
      storyInput.extend({
        order: z.array(z.number().int().positive()).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireEnabled();
      await ownStory(input.storyId, ctx.user.id);
      await reorderChapters(input.storyId, ctx.user.id, input.order);
      return { ok: true as const };
    }),

  remove: protectedProcedure
    .input(chapterInput)
    .mutation(async ({ ctx, input }) => {
      requireEnabled();
      await deleteChapter(input.chapterId, ctx.user.id);
      return { ok: true as const };
    }),

  sharingHistory: protectedProcedure.input(chapterInput).query(async ({ctx,input}) => {
    requireEnabled();
    const chapter = await ownChapter(input.chapterId,ctx.user.id);
    const roots = [...new Set([...(chapter.blocks.lineage ? [chapter.blocks.lineage.rootPackageId] : []), ...(await listOwnChapterExports(chapter.id,ctx.user.id)).map(row=>row.packageId)])];
    const rows = await listOwnChapterDeliveryHistory(ctx.user.id,roots);
    const recipientIds = [...new Set(rows.filter(row=>row.delivery.senderUserId===ctx.user.id&&row.delivery.recipientUserId).map(row=>row.delivery.recipientUserId!))];
    const names = new Map(await Promise.all(recipientIds.map(async id=>[id,(await getUserById(id))?.name || "未设置称呼的用户"] as const)));
    return rows.map(({delivery,packageJson})=>({
      id:delivery.deliveryId, direction:delivery.senderUserId===ctx.user.id?"sent" as const:"received" as const,
      senderName:packageJson.sender.displayName, recipientName:delivery.recipientUserId===ctx.user.id?"你":delivery.recipientUserId?names.get(delivery.recipientUserId)||"未设置称呼的用户":"尚未领取",
      status:delivery.status, createdAt:delivery.createdAt, packageId:delivery.packageId,
    }));
  }),

  versions: protectedProcedure
    .input(chapterInput)
    .query(async ({ ctx, input }) => {
      requireEnabled();
      await ownChapter(input.chapterId, ctx.user.id);
      return (await listChapterVersions(input.chapterId, ctx.user.id)).map(
        row => ({
          version: row.version,
          title: row.title,
          reason: row.reason,
          attribution: row.blocks.attribution ?? null,
          createdAt: row.createdAt,
        })
      );
    }),

  /** Put an older version back as a new version. */
  restoreVersion: protectedProcedure
    .input(
      chapterInput.extend({
        version: z.number().int().positive(),
        expectedVersion: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireEnabled();
      const chapter = await ownChapter(input.chapterId, ctx.user.id);
      const old = (await listChapterVersions(chapter.id, ctx.user.id)).find(
        row => row.version === input.version
      );
      if (!old)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "这个旧版本已不在保留范围内",
        });
      return view(
        await saveChapterContent({
          id: chapter.id,
          userId: ctx.user.id,
          expectedVersion: input.expectedVersion,
          reason: "restore",
          content: { title: old.title, blocks: { ...old.blocks, attribution: { ...old.blocks.attribution, editorName: artworkAuthorName(ctx.user.name), action: "restored" } }, layout: old.layout },
        })
      );
    }),

  /** Build a package for download; image urls are fresh and short-lived. */
  exportPackage: protectedProcedure
    .input(chapterInput)
    .mutation(async ({ ctx, input }) => {
      requireEnabled();
      const chapter = await ownChapter(input.chapterId, ctx.user.id);
      const story = await ownStory(chapter.storyId, ctx.user.id);
      const packageId = newPackageId();
      // Pictures the editor references by its own url are read from the image
      // library here; stored ones keep the facts saved with the chapter.
      const extra = await resolveExportImages(
        [
          ...(chapter.blocks.coverKey ? [chapter.blocks.coverKey] : []),
          ...(chapter.blocks.bodyTextureKey
            ? [chapter.blocks.bodyTextureKey]
            : []),
          ...chapter.blocks.illustrations.map(item => item.key),
          ...layoutImageKeys(
            readChapterLayout(chapter.title, chapter.blocks, chapter.layout)
          ),
        ],
        chapter.blocks.images,
        new Set(
          (await getStoryGeneratedImages(chapter.storyId, ctx.user.id)).map(
            image => image.imageUrl
          )
        )
      );
      const packed = packChapter(
        chapter,
        {
          packageId,
          displayName: artworkAuthorName(ctx.user.name),
          storyTitle: story.title,
        },
        { ...chapter.blocks.images, ...extra.facts }
      );
      await recordChapterExport({
        packageId,
        chapterId: chapter.id,
        storyId: chapter.storyId,
        userId: ctx.user.id,
      });
      const { files, missing } = await loadImageFiles(
        packed.package,
        packed.assetKeys,
        extra.bytes
      );
      return {
        package: packed.package,
        warnings: packed.warnings,
        images: files,
        /** Pictures left out because they could not be read or exceed the package limits. */
        droppedImages: packed.droppedImages + extra.dropped,
        /** Pictures in the package whose stored bytes could not be read. */
        missingImageBytes: missing,
      };
    }),

  /**
   * `keep` makes a new story; `append` adds the package as the last chapter of
   * `storyId`. A package descending from this user's own export becomes a
   * candidate on that chapter instead. `requestId` makes retries harmless.
   */
  importPackage: protectedProcedure
    .input(
      z.object({
        requestId: z.string().uuid(),
        mode: z.enum(["keep", "append"]),
        storyId: z.number().int().positive().optional(),
        package: z.unknown(),
        images: z
          .array(
            z.object({
              assetId: z.string().max(80),
              base64: z.string().max(2_800_000),
            })
          )
          .max(12)
          .default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireEnabled();
      const parsed = safeParseChapterPackage(input.package);
      if (!parsed.ok)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "这不是有效的章节包",
        });
      const pkg = parsed.package;
      const requestHash = createHash("sha256")
        .update(
          JSON.stringify([pkg, input.images, input.mode, input.storyId ?? null])
        )
        .digest("hex");
      const prior = await findImportReceipt(ctx.user.id, input.requestId);
      if (prior) {
        if (prior.requestHash !== requestHash)
          throw new TRPCError({
            code: "CONFLICT",
            message: "这次导入已完成，请重新选择文件",
          });
        return {
          outcome: prior.outcome,
          storyId: prior.storyId,
          chapterId: prior.chapterId,
          repeated: true as const,
          missingImages: 0,
        };
      }
      const limit = await consumePersistentRateLimit({
        scope: "chapter:import",
        subject: String(ctx.user.id),
        windowSeconds: 3600,
        maxAttempts: CHAPTER_IMPORT_PER_HOUR,
      });
      if (!limit.allowed)
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "导入太频繁，请一小时后再试",
        });

      const returned = await findOwnExport(
        pkg.lineage.rootPackageId,
        ctx.user.id
      );
      const target = returned
        ? await getChapter(returned.chapterId, ctx.user.id)
        : null;
      if (!target && input.mode === "append") {
        if (!input.storyId)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "请选择要加入的故事",
          });
        await ownStory(input.storyId, ctx.user.id);
      }
      const targetSource = target
        ? (target.blocks.sourceChapterId ?? `chapter-${target.id}`)
        : undefined;
      if (
        target &&
        (pkg.chapters.length !== 1 ||
          pkg.chapters[0].chapterId !== targetSource)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "发回包与原章节不对应",
        });
      const keyOf = await storeImages(ctx.user.id, pkg, input.images);
      const unpacked = pkg.chapters.map(item =>
        unpackChapter(pkg, keyOf, item.chapterId)
      );
      const first = unpacked[0];
      const result = await commitChapterImport({
        userId: ctx.user.id,
        requestId: input.requestId,
        requestHash,
        storyId: input.mode === "append" ? input.storyId : undefined,
        targetChapterId: target?.id,
        title: (pkg.storyTitle || first.title).slice(0, 255),
        packageId: pkg.packageId,
        senderName: pkg.sender.displayName || "朋友",
        contents: unpacked.map(chapter => chapter.content),
      });
      return {
        ...result,
        missingImages: unpacked.reduce(
          (sum, chapter) => sum + chapter.missingImages,
          0
        ),
      };
    }),

  candidates: protectedProcedure
    .input(chapterInput)
    .query(async ({ ctx, input }) => {
      requireEnabled();
      await ownChapter(input.chapterId, ctx.user.id);
      const rows = await listReturnCandidates(input.chapterId, ctx.user.id);
      const urls = await imageUrls(
        rows
          .flatMap(row =>
            chapterKeys(
              row.blocks,
              readChapterLayout(row.title, row.blocks, row.layout)
            )
          )
          .filter(isStoredImageKey)
      );
      return {
        imageUrls: urls,
        candidates: rows.map(row => ({
          id: row.id,
          packageId: row.packageId,
          senderName: row.senderName,
          title: row.title,
          blocks: row.blocks,
          layout: readChapterLayout(row.title, row.blocks, row.layout),
          status: row.status,
          createdAt: row.createdAt,
        })),
      };
    }),

  /** Adopting writes a new chapter version; the previous one stays recoverable. */
  resolveCandidate: protectedProcedure
    .input(
      z.object({
        candidateId: z.number().int().positive(),
        status: z.enum(["adopted", "dismissed"]),
        expectedVersion: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireEnabled();
      const candidate = await getReturnCandidate(
        input.candidateId,
        ctx.user.id
      );
      if (!candidate)
        throw new TRPCError({ code: "NOT_FOUND", message: "这个版本已不存在" });
      if (candidate.status !== "pending")
        throw new TRPCError({
          code: "CONFLICT",
          message: "这个版本已经处理过了",
        });
      if (input.status === "adopted") {
        if (input.expectedVersion === undefined)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "请先对照当前版本再采用",
          });
        const chapter = await ownChapter(candidate.chapterId, ctx.user.id);
        const saved = await saveChapterContent({
          id: chapter.id,
          userId: ctx.user.id,
          expectedVersion: input.expectedVersion!,
          reason: "adopt-candidate",
          candidateId: candidate.id,
          content: {
            title: candidate.title,
            blocks: { ...candidate.blocks, attribution: candidate.blocks.attribution ?? { editorName: candidate.senderName, sourceName: candidate.senderName, action: "received" } },
            layout: candidate.layout,
          },
        });
        return { chapter: view(saved) };
      }
      await setCandidateStatus(candidate.id, ctx.user.id, "dismissed");
      return { chapter: null };
    }),
});
