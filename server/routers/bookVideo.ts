import { getStoryImageAssets } from "../services/imageAssets";
import { TRPCError } from "@trpc/server";
import { getStoryById } from "../repositories/stories";
import { bookVideoImageContinuity } from "../services/bookVideoImageContinuity";
import { normalizePublishingDraftState } from "../../shared/publishingDraft";
import { chapterEnabled } from "../../shared/chapterStore";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { publishingArticleLayoutSchema } from "../../shared/publishingArticleVideo";
import { videoShotEditSchema } from "../../shared/bookVideoCreation";
import {
  listBookVideoRecords,
  proposeBookVideo,
  generateBookVideo,
  editBookVideo,
  adoptBookVideo,
} from "../services/bookVideoCreation";
const owner = z.object({ storyId: z.number().int().positive() });
const record = owner.extend({ id: z.string().min(8).max(100) });
export const bookVideoRouter = router({
  prepareManuscript: protectedProcedure
    .input(owner.extend({ request: z.string().trim().min(1).max(4000) }))
    .mutation(() => {
      if (!chapterEnabled())
        // The legacy article-to-video conversation still works with chapters off.
        return { chapters: [], shotCount: 0, changed: false };
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "请从书页的“作品版本与转换”生成并确认独立分镜版，原文字版会保留。" });
    }),
  list: protectedProcedure.input(owner).query(async ({ ctx, input }) => {
    const records = await listBookVideoRecords({
      ...input,
      userId: ctx.user.id,
    });
    const assets = await getStoryImageAssets(input.storyId, ctx.user.id);
    const story = await getStoryById(input.storyId, ctx.user.id);
    const body = story?.body as { publishing?: unknown } | undefined;
    const publishing = normalizePublishingDraftState(body?.publishing);
    const confirmed = publishing.versions?.flatMap(version => {
      const candidate=version.videoStoryboard?.confirmed;
      return candidate && candidate.groupId===publishing.activeVideoStoryboardGroupId ? [candidate] : [];
    })[0];
    return {
      records,
      continuity: bookVideoImageContinuity(records, assets, confirmed),
      images: Object.fromEntries(
        assets
          .filter(a => a.availability !== "missing")
          .map(a => [a.id, a.imageUrl])
      ) as Record<number, string>,
    };
  }),
  propose: protectedProcedure
    .input(
      record.extend({
        parentId: z.string().min(8).max(100).optional(),
        versionId: z.string().min(1).max(64),
        request: z.string().trim().min(1).max(4000),
        layout: publishingArticleLayoutSchema,
      })
    )
    .mutation(({ ctx, input }) =>
      proposeBookVideo({ ...input, userId: ctx.user.id, actor: { userId: ctx.user.id, name: ctx.user.name || "未设置称呼" } })
    ),
  generate: protectedProcedure
    .input(record.extend({ confirmBrief: z.boolean().optional() }))
    .mutation(({ ctx, input }) =>
      generateBookVideo({ ...input, userId: ctx.user.id })
    ),
  edit: protectedProcedure
    .input(
      record.extend({
        revision: z.number().int().positive(),
        shots: z.array(videoShotEditSchema).min(1).max(100),
      })
    )
    .mutation(({ ctx, input }) =>
      editBookVideo({ ...input, userId: ctx.user.id })
    ),
  adopt: protectedProcedure
    .input(
      record.extend({
        reviewedRevision: z.number().int().positive().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      adoptBookVideo({ ...input, userId: ctx.user.id, actor: { userId: ctx.user.id, name: ctx.user.name || "未设置称呼" } })
    ),
});
