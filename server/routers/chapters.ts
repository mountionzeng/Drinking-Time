import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { artworkAuthorName } from "../../shared/artworkShare";
import { safeParseChapterPackage } from "../../shared/chapterPackage";
import {
  CHAPTER_IMPORT_PER_HOUR,
  chapterEnabled,
  chapterLayoutSchema,
  chapterTitleSchema,
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
  insertImportReceipt,
  insertReturnCandidate,
  listChapterVersions,
  listChapters,
  listReturnCandidates,
  recordChapterExport,
  reorderChapters,
  saveChapterContent,
  setCandidateStatus,
} from "../repositories/chapters";
import { createStory, getStoryById } from "../repositories/stories";
import {
  chapterKeys,
  imageUrls,
  newPackageId,
  packChapter,
  storeImages,
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
  if (!chapter) throw new TRPCError({ code: "NOT_FOUND", message: "这一章不存在" });
  return chapter;
}
const view = (c: Awaited<ReturnType<typeof ownChapter>>) => ({
  id: c.id,
  storyId: c.storyId,
  position: c.position,
  title: c.title,
  blocks: c.blocks,
  layout: c.layout,
  version: c.version,
  updatedAt: c.updatedAt,
});
const emptyBlocks = (body: string): StoredChapterBlocks => ({
  body,
  blockIds: [],
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
    return { chapter: view(chapter), imageUrls: await imageUrls(chapterKeys(chapter.blocks)) };
  }),

  create: protectedProcedure
    .input(storyInput.extend({ title: chapterTitleSchema, body: z.string().max(MAX_BODY).default("") }))
    .mutation(async ({ ctx, input }) => {
      requireEnabled();
      await ownStory(input.storyId, ctx.user.id);
      return view(
        await insertChapter({
          storyId: input.storyId,
          userId: ctx.user.id,
          content: { title: input.title, blocks: emptyBlocks(input.body), layout: null },
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireEnabled();
      const chapter = await ownChapter(input.chapterId, ctx.user.id);
      const blocks =
        input.body === undefined ? undefined : { ...chapter.blocks, body: input.body };
      return view(
        await saveChapterContent({
          id: chapter.id,
          userId: ctx.user.id,
          expectedVersion: input.expectedVersion,
          reason: "edit",
          content: { title: input.title, blocks, layout: input.layout },
        })
      );
    }),

  reorder: protectedProcedure
    .input(storyInput.extend({ order: z.array(z.number().int().positive()).max(100) }))
    .mutation(async ({ ctx, input }) => {
      requireEnabled();
      await ownStory(input.storyId, ctx.user.id);
      await reorderChapters(input.storyId, ctx.user.id, input.order);
      return { ok: true as const };
    }),

  remove: protectedProcedure.input(chapterInput).mutation(async ({ ctx, input }) => {
    requireEnabled();
    await deleteChapter(input.chapterId, ctx.user.id);
    return { ok: true as const };
  }),

  versions: protectedProcedure.input(chapterInput).query(async ({ ctx, input }) => {
    requireEnabled();
    await ownChapter(input.chapterId, ctx.user.id);
    return (await listChapterVersions(input.chapterId, ctx.user.id)).map(row => ({
      version: row.version,
      title: row.title,
      reason: row.reason,
      createdAt: row.createdAt,
    }));
  }),

  /** Put an older version back as a new version. */
  restoreVersion: protectedProcedure
    .input(chapterInput.extend({ version: z.number().int().positive(), expectedVersion: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      requireEnabled();
      const chapter = await ownChapter(input.chapterId, ctx.user.id);
      const old = (await listChapterVersions(chapter.id, ctx.user.id)).find(
        row => row.version === input.version
      );
      if (!old) throw new TRPCError({ code: "NOT_FOUND", message: "这个旧版本已不在保留范围内" });
      return view(
        await saveChapterContent({
          id: chapter.id,
          userId: ctx.user.id,
          expectedVersion: input.expectedVersion,
          reason: "restore",
          content: { title: old.title, blocks: old.blocks, layout: old.layout },
        })
      );
    }),

  /** Build a package for download; image urls are fresh and short-lived. */
  exportPackage: protectedProcedure.input(chapterInput).mutation(async ({ ctx, input }) => {
    requireEnabled();
    const chapter = await ownChapter(input.chapterId, ctx.user.id);
    const story = await ownStory(chapter.storyId, ctx.user.id);
    const packageId = newPackageId();
    const packed = packChapter(chapter, {
      packageId,
      displayName: artworkAuthorName(ctx.user.name),
      storyTitle: story.title,
    });
    await recordChapterExport({ packageId, chapterId: chapter.id, storyId: chapter.storyId, userId: ctx.user.id });
    const urls = await imageUrls(Object.values(packed.assetKeys));
    return {
      package: packed.package,
      warnings: packed.warnings,
      images: Object.entries(packed.assetKeys).map(([assetId, key]) => ({ assetId, url: urls[key] })),
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
          .array(z.object({ assetId: z.string().max(80), base64: z.string().max(14_000_000) }))
          .max(60)
          .default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireEnabled();
      const parsed = safeParseChapterPackage(input.package);
      if (!parsed.ok)
        throw new TRPCError({ code: "BAD_REQUEST", message: "这不是有效的章节包" });
      const pkg = parsed.package;
      const requestHash = createHash("sha256")
        .update(JSON.stringify([pkg.packageId, input.mode, input.storyId ?? null]))
        .digest("hex");
      const prior = await findImportReceipt(ctx.user.id, input.requestId);
      if (prior) {
        if (prior.requestHash !== requestHash)
          throw new TRPCError({ code: "CONFLICT", message: "这次导入已完成，请重新选择文件" });
        return { outcome: prior.outcome, storyId: prior.storyId, chapterId: prior.chapterId, repeated: true as const, missingImages: 0 };
      }
      const limit = await consumePersistentRateLimit({
        scope: "chapter:import",
        subject: String(ctx.user.id),
        windowSeconds: 3600,
        maxAttempts: CHAPTER_IMPORT_PER_HOUR,
      });
      if (!limit.allowed)
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "导入太频繁，请一小时后再试" });

      const returned = await findOwnExport(pkg.lineage.rootPackageId, ctx.user.id);
      const keyOf = await storeImages(ctx.user.id, pkg, input.images);
      const unpacked = unpackChapter(pkg, keyOf);

      const target = returned ? await getChapter(returned.chapterId, ctx.user.id) : null;
      let storyId: number;
      let chapterId: number;
      let outcome: "keep" | "append" | "candidate";
      if (target) {
        await insertReturnCandidate({
          chapterId: target.id,
          storyId: target.storyId,
          userId: ctx.user.id,
          packageId: pkg.packageId,
          senderName: pkg.sender.displayName || "朋友",
          content: unpacked.content,
        });
        storyId = target.storyId;
        chapterId = target.id;
        outcome = "candidate";
      } else if (input.mode === "keep") {
        const created = await createStory({
          userId: ctx.user.id,
          title: (pkg.storyTitle || unpacked.title).slice(0, 255),
        } as Parameters<typeof createStory>[0]);
        storyId = created.id;
        outcome = "keep";
        chapterId = (await insertChapter({ storyId, userId: ctx.user.id, content: unpacked.content })).id;
      } else {
        if (!input.storyId)
          throw new TRPCError({ code: "BAD_REQUEST", message: "请选择要加入的故事" });
        await ownStory(input.storyId, ctx.user.id);
        storyId = input.storyId;
        outcome = "append";
        chapterId = (await insertChapter({ storyId, userId: ctx.user.id, content: unpacked.content })).id;
      }
      await insertImportReceipt({
        userId: ctx.user.id,
        requestId: input.requestId,
        requestHash,
        storyId,
        chapterId,
        outcome,
      });
      return {
        outcome,
        storyId,
        chapterId,
        repeated: false as const,
        missingImages: unpacked.missingImages,
      };
    }),

  candidates: protectedProcedure.input(chapterInput).query(async ({ ctx, input }) => {
    requireEnabled();
    await ownChapter(input.chapterId, ctx.user.id);
    const rows = await listReturnCandidates(input.chapterId, ctx.user.id);
    const urls = await imageUrls(rows.flatMap(row => chapterKeys(row.blocks)));
    return {
      imageUrls: urls,
      candidates: rows.map(row => ({
        id: row.id,
        senderName: row.senderName,
        title: row.title,
        blocks: row.blocks,
        layout: row.layout,
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
      const candidate = await getReturnCandidate(input.candidateId, ctx.user.id);
      if (!candidate) throw new TRPCError({ code: "NOT_FOUND", message: "这个版本已不存在" });
      if (candidate.status !== "pending")
        throw new TRPCError({ code: "CONFLICT", message: "这个版本已经处理过了" });
      if (input.status === "adopted") {
        const chapter = await ownChapter(candidate.chapterId, ctx.user.id);
        const saved = await saveChapterContent({
          id: chapter.id,
          userId: ctx.user.id,
          expectedVersion: input.expectedVersion ?? chapter.version,
          reason: "adopt-candidate",
          content: { title: candidate.title, blocks: candidate.blocks, layout: candidate.layout },
        });
        await setCandidateStatus(candidate.id, ctx.user.id, "adopted");
        return { chapter: view(saved) };
      }
      await setCandidateStatus(candidate.id, ctx.user.id, "dismissed");
      return { chapter: null };
    }),
});
