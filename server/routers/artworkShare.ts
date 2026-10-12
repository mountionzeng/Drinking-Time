import { createHash } from "node:crypto";
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
  create: protectedProcedure
    .input(artworkShareCreateSchema)
    .mutation(async ({ ctx, input }) => {
      await own(input.storyId, ctx.user.id);
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
          JSON.stringify({ title: input.title, pages: input.pages })
        ),
        snapshot: { title: input.title, author: { name: artworkAuthorName(ctx.user.name) }, pages },
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
  revoke: protectedProcedure
    .input(z.object({ storyId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await own(input.storyId, ctx.user.id);
      await revokeArtworkShares(ctx.user.id, input.storyId);
      return { ok: true };
    }),
});
