import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getStoryById } from "../repositories/stories";
import {
  countStoryContextShares,
  importStoryContextShare,
  insertStoryContextShare,
  readStoryContextShare,
  revokeStoryContextShares,
} from "../repositories/storyContextShares";
import { loadStoryPromptAggregate } from "../services/promptLineageStore";
import {
  createStoryContextSnapshot,
  buildInheritedStoryInput,
} from "../services/storyContextSnapshot";
import {
  storyContextSnapshotSchema,
  STORY_SHARE_TOKEN_PATTERN,
  inheritedStorySnapshot,
  canAcceptStoryShare,
} from "../../shared/storyContextShare";

const ownerInput = z.object({ storyId: z.number().int().positive() });
const previewInput = ownerInput.extend({
  includeConversation: z.boolean().default(false),
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
  const body = (story.body ?? {}) as Record<string, unknown>;
  const messages = new Map<string, unknown>();
  if (input.includeConversation) {
    const durable =
      (await loadStoryPromptAggregate({ storyId: story.id, userId }))
        ?.messages ?? [];
    for (const value of [
      ...(Array.isArray(body.messages) ? body.messages : []),
      ...durable,
    ]) {
      if (!value || typeof value !== "object") continue;
      const message = value as Record<string, unknown>;
      messages.set(
        String(
          message.clientMessageId ??
            message.id ??
            `${message.role}:${message.content}`
        ),
        message
      );
    }
  }
  const snapshot = createStoryContextSnapshot(
    { ...story, body: { ...body, messages: [...messages.values()] } },
    input
  );
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
      const storyId = await importStoryContextShare(
        hash(input.token),
        ctx.user.id,
        share => buildInheritedStoryInput(share.snapshot, ctx.user.id)
      );
      if (!(await getStoryById(storyId, ctx.user.id)))
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "你之前创建的故事已删除",
        });
      return { storyId };
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
});
