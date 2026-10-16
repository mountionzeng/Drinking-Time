import {
  shareContributionInput,
  VIEW_ONLY,
} from "../../shared/sharePermissions";
import { canAcceptStoryShare } from "../../shared/storyContextShare";
import {
  forkSharedStory,
  contributeSharedStory,
} from "../repositories/sharedStoryActions";
import { createHash } from "node:crypto";
import { archiveArtwork } from "../services/artworkArchive";
import sharp from "sharp";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getStoryById } from "../repositories/stories";
import {
  readArtworkShare,
  revokeArtworkShares,
  saveArtworkShare,
} from "../repositories/artworkShares";
import {
  artworkShareCreateSchema,
  artworkShareTokenSchema,
  artworkAuthorName,
  type ArtworkSnapshot,
} from "../../shared/artworkShare";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
async function own(storyId: number, userId: number) {
  if (!(await getStoryById(storyId, userId)))
    throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在或无权访问" });
}
export const artworkShareRouter = router({
  archive: protectedProcedure
    .input(artworkShareCreateSchema)
    .mutation(({ ctx, input }) => archiveArtwork({ ...input, userId: ctx.user.id })),
  create: protectedProcedure
    .input(artworkShareCreateSchema)
    .mutation(async ({ ctx, input }) => {
      await own(input.storyId, ctx.user.id);
      const permissions = input.permissions ?? VIEW_ONLY;
      if ((permissions.rewrite || permissions.fork) && !input.work)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "请先确认允许对方使用的作品文字",
        });
      const work =
        permissions.rewrite || permissions.fork ? input.work : undefined;
      const pages: ArtworkSnapshot["pages"] = [];
      for (const page of input.pages) {
        try {
          // Decode and re-encode pixels: never publish arbitrary URLs, SVG, EXIF or uploaded metadata.
          const image = sharp(
            Buffer.from(page.slice(page.indexOf(",") + 1), "base64"),
            { limitInputPixels: 4_000_000, animated: false }
          );
          const meta = await image.metadata();
          if (
            !meta.width ||
            !meta.height ||
            (meta.pages && meta.pages > 1) ||
            !["png", "webp"].includes(meta.format ?? "")
          )
            throw new Error("Invalid image");
          const { data, info } = await image
            .resize({ width: 1080, withoutEnlargement: true })
            .webp({ quality: 90 })
            .toBuffer({ resolveWithObject: true });
          pages.push({
            dataUrl: `data:image/webp;base64,${data.toString("base64")}`,
            width: info.width,
            height: info.height,
          });
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "图片无法读取或尺寸过大，请重新排版后分享",
          });
        }
      }
      await saveArtworkShare({
        tokenHash: hash(input.token),
        userId: ctx.user.id,
        storyId: input.storyId,
        fingerprint: hash(
          JSON.stringify({
            title: input.title,
            pages: input.pages,
            ...(input.permissions ? { permissions, work } : {}),
          })
        ),
        snapshot: {
          title: input.title,
          author: { name: artworkAuthorName(ctx.user.name) },
          pages,
          permissions,
          ...(work ? { work } : {}),
        },
        createdAt: new Date(),
        revokedAt: null,
      });
      return { path: `/p/${input.token}` };
    }),
  read: publicProcedure
    .input(z.object({ token: artworkShareTokenSchema }))
    .query(async ({ ctx, input }) => {
      ctx.res.setHeader("Cache-Control", "no-store");
      return readArtworkShare(hash(input.token));
    }),
  accept: protectedProcedure
    .input(z.object({ token: artworkShareTokenSchema }))
    .mutation(async ({ ctx, input }) => {
      if (!canAcceptStoryShare(ctx.user))
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "请先登录，再创建自己的故事",
        });
      const storyId = await forkSharedStory(
        "artwork",
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
    .input(
      z.object({ token: artworkShareTokenSchema }).merge(shareContributionInput)
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAcceptStoryShare(ctx.user))
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "请先登录，再提交改写",
        });
      return contributeSharedStory("artwork", hash(input.token), {
        ...input,
        userId: ctx.user.id,
        authorName: artworkAuthorName(ctx.user.name),
      });
    }),
  revoke: protectedProcedure
    .input(z.object({ storyId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await own(input.storyId, ctx.user.id);
      await revokeArtworkShares(ctx.user.id, input.storyId);
      return { ok: true };
    }),
});
