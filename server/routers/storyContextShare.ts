import {
  sharePermissionsSchema,
  sharedWorkSchema,
  shareContributionInput,
  VIEW_ONLY,
} from "../../shared/sharePermissions";
import {
  forkSharedStory,
  contributeSharedStory,
  shareBackFork,
  shareBackStatus,
} from "../repositories/sharedStoryActions";
import { artworkAuthorName } from "../../shared/artworkShare";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import {
  getStoryById,
  listRecentUserStoryBodies,
} from "../repositories/stories";
import { collectShareBacks } from "../../shared/shareBackInbox";
import {
  countStoryContextShares,
  insertStoryContextShare,
  readStoryContextShare,
  revokeStoryContextShares,
} from "../repositories/storyContextShares";
import { createStoryContextSnapshot } from "../services/storyContextSnapshot";
import {
  storyContextSnapshotSchema,
  STORY_SHARE_TOKEN_PATTERN,
  inheritedStorySnapshot,
  canAcceptStoryShare,
} from "../../shared/storyContextShare";

const ownerInput = z.object({ storyId: z.number().int().positive() });
const previewInput = ownerInput.extend({
  permissions: sharePermissionsSchema.default(VIEW_ONLY),
  includeConversation: z.literal(false).default(false),
  article: storyContextSnapshotSchema.shape.article.optional(),
});
const tokenInput = z.object({
  token: z.string().length(43).regex(STORY_SHARE_TOKEN_PATTERN),
});
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

async function owned(storyId: number, userId: number) {
  const story = await getStoryById(storyId, userId);
  if (!story)
    throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在或无权访问" });
  return story;
}

async function prepareShare(
  input: z.infer<typeof previewInput>,
  userId: number
) {
  const story = await owned(input.storyId, userId);
  const snapshot = createStoryContextSnapshot(story, {
    ...input,
    workOnly: true,
  });
  if (!snapshot.article?.body.trim())
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "请先写好要分享的正文",
    });
  if (input.permissions.rewrite || input.permissions.fork)
    sharedWorkSchema.parse(snapshot.article);
  snapshot.permissions = input.permissions;
  return {
    snapshot,
    fingerprint: hash(JSON.stringify(snapshot)),
  };
}

export const storyContextShareRouter = router({
  preview: protectedProcedure
    .input(previewInput)
    .query(async ({ ctx, input }) => ({
      ...(await prepareShare(input, ctx.user.id)),
      activeLinks: await countStoryContextShares(input.storyId, ctx.user.id),
    })),
  create: protectedProcedure
    .input(previewInput.extend({ fingerprint: z.string().length(64) }))
    .mutation(async ({ ctx, input }) => {
      const prepared = await prepareShare(input, ctx.user.id);
      if (prepared.fingerprint !== input.fingerprint)
        throw new TRPCError({
          code: "CONFLICT",
          message: "故事内容已变化，请重新预览后分享",
        });
      const token = randomBytes(32).toString("base64url");
      await insertStoryContextShare({
        tokenHash: hash(token),
        storyId: input.storyId,
        userId: ctx.user.id,
        snapshot: prepared.snapshot,
        createdAt: new Date(),
        revokedAt: null,
      });
      return { path: `/s/${token}` };
    }),
  read: publicProcedure.input(tokenInput).query(async ({ ctx, input }) => {
    ctx.res.setHeader("Cache-Control", "no-store");
    const share = await readStoryContextShare(hash(input.token));
    return { snapshot: share.snapshot };
  }),
  accept: protectedProcedure
    .input(tokenInput)
    .mutation(async ({ ctx, input }) => {
      if (!canAcceptStoryShare(ctx.user))
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "请先登录，再创建属于你的故事",
        });
      const storyId = await forkSharedStory(
        "story",
        hash(input.token),
        ctx.user.id
      );
      if (!(await getStoryById(storyId, ctx.user.id)))
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "你之前创建的故事已删除",
        });
      return { storyId };
    }),
  contribute: protectedProcedure
    .input(tokenInput.merge(shareContributionInput))
    .mutation(async ({ ctx, input }) => {
      if (!canAcceptStoryShare(ctx.user))
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "请先登录，再提交改写",
        });
      return contributeSharedStory("story", hash(input.token), {
        ...input,
        userId: ctx.user.id,
        authorName: artworkAuthorName(ctx.user.name),
      });
    }),
  revoke: protectedProcedure
    .input(ownerInput)
    .mutation(async ({ ctx, input }) => {
      await owned(input.storyId, ctx.user.id);
      await revokeStoryContextShares(input.storyId, ctx.user.id);
      return { ok: true };
    }),
  source: protectedProcedure
    .input(ownerInput)
    .query(async ({ ctx, input }) =>
      inheritedStorySnapshot((await owned(input.storyId, ctx.user.id)).body)
    ),
  /** 作者自己的故事里，朋友分享回来、还没采用/忽略的文字和排版。 */
  shareBackInbox: protectedProcedure.query(async ({ ctx }) => ({
    notices: collectShareBacks(await listRecentUserStoryBodies(ctx.user.id)),
  })),
  backStatus: protectedProcedure
    .input(ownerInput)
    .query(async ({ ctx, input }) => {
      await owned(input.storyId, ctx.user.id);
      return shareBackStatus(ctx.user.id, input.storyId);
    }),
  shareBack: protectedProcedure
    .input(ownerInput.extend({ operationToken: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!canAcceptStoryShare(ctx.user))
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "请先登录，再分享回给作者",
        });
      const story = await owned(input.storyId, ctx.user.id);
      return shareBackFork({
        userId: ctx.user.id,
        storyId: input.storyId,
        authorName: artworkAuthorName(ctx.user.name),
        operationToken: input.operationToken,
        body: story.body,
      });
    }),
});
