import {
  shareContributionInput,
  VIEW_ONLY,
} from "../../shared/sharePermissions";
import { canAcceptStoryShare } from "../../shared/storyContextShare";
import {
  forkSharedStory,
  contributeSharedStory,
  shareBackTarget,
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
  type PublicArtworkSnapshot,
} from "../../shared/artworkShare";
import {
  publicSharedLayout,
  readSharedLayoutState,
  sharedLayoutPackageSchema,
  SHARED_LAYOUT_MAX_CANDIDATES,
} from "../../shared/sharedLayout";
import {
  layoutRequestHash,
  sanitizeLayoutPackage,
  storeLayoutForStory,
  writeSharedLayout,
} from "../services/sharedLayout";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
async function own(storyId: number, userId: number) {
  const story = await getStoryById(storyId, userId);
  if (!story)
    throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在或无权访问" });
  return story;
}
const storyInput = z.object({ storyId: z.number().int().positive() });
export const artworkShareRouter = router({
  archive: protectedProcedure
    .input(artworkShareCreateSchema)
    .mutation(({ ctx, input }) =>
      archiveArtwork({ ...input, userId: ctx.user.id })
    ),
  create: protectedProcedure
    .input(artworkShareCreateSchema)
    .mutation(async ({ ctx, input }) => {
      await own(input.storyId, ctx.user.id);
      const permissions = input.permissions ?? VIEW_ONLY;
      const editable = permissions.rewrite || permissions.fork;
      if (editable && !input.work)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "请先确认允许对方使用的作品文字",
        });
      // View-only links publish finished pictures only, never the editable layout.
      if (input.layout && !editable)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "只有允许对方改写或另存时才能分享可编辑排版",
        });
      const work = editable ? input.work : undefined;
      const layout = input.layout
        ? await sanitizeLayoutPackage(input.layout)
        : undefined;
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
            ...(input.layout ? { layout: input.layout } : {}),
          })
        ),
        snapshot: {
          title: input.title,
          author: { name: artworkAuthorName(ctx.user.name) },
          pages,
          permissions,
          ...(work ? { work } : {}),
          ...(layout ? { layout } : {}),
        },
        createdAt: new Date(),
        revokedAt: null,
      });
      return { path: `/p/${input.token}` };
    }),
  read: publicProcedure
    .input(z.object({ token: artworkShareTokenSchema }))
    .query(async ({ ctx, input }): Promise<PublicArtworkSnapshot> => {
      ctx.res.setHeader("Cache-Control", "no-store");
      const { layout, ...snapshot } = (await readArtworkShare(
        hash(input.token)
      )) as ArtworkSnapshot;
      return { ...snapshot, hasLayout: Boolean(layout) };
    }),
  accept: protectedProcedure
    .input(z.object({ token: artworkShareTokenSchema }))
    .mutation(async ({ ctx, input }) => {
      if (!canAcceptStoryShare(ctx.user))
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "请先登录，再创建自己的故事",
        });
      const tokenHash = hash(input.token);
      const storyId = await forkSharedStory("artwork", tokenHash, ctx.user.id);
      const story = await getStoryById(storyId, ctx.user.id);
      if (!story)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "你之前创建的故事已删除",
        });
      const snapshot = (await readArtworkShare(tokenHash)) as ArtworkSnapshot;
      const existing = readSharedLayoutState(
        (story.body as Record<string, unknown> | null)?.sharedLayout
      );
      // Copy the author's layout and pictures into the recipient's own story once.
      // A failed copy leaves no inherited layout, so accepting again retries it.
      if (snapshot.layout && !existing.inherited) {
        const inherited = await storeLayoutForStory({
          userId: ctx.user.id,
          storyId,
          authorName: snapshot.author?.name ?? "作者",
          layout: snapshot.layout,
        });
        await writeSharedLayout(ctx.user.id, storyId, state => ({
          state: state.inherited ? null : { ...state, inherited },
          result: undefined,
        }));
      }
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
    .input(storyInput)
    .mutation(async ({ ctx, input }) => {
      await own(input.storyId, ctx.user.id);
      await revokeArtworkShares(ctx.user.id, input.storyId);
      return { ok: true };
    }),
  /** Layouts shared with this story: the inherited one and co-edited candidates. */
  layout: protectedProcedure.input(storyInput).query(async ({ ctx, input }) => {
    const story = await own(input.storyId, ctx.user.id);
    return publicSharedLayout(
      readSharedLayoutState(
        (story.body as Record<string, unknown> | null)?.sharedLayout
      )
    );
  }),
  /**
   * Send the recipient's whole layout page set back to the author as a pending
   * candidate labelled with the recipient's name. The author's own layout only
   * changes after the author adopts it.
   */
  shareBackLayout: protectedProcedure
    .input(
      storyInput.extend({
        operationToken: z.string().uuid(),
        layout: sharedLayoutPackageSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!canAcceptStoryShare(ctx.user))
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "请先登录，再分享回给作者",
        });
      await own(input.storyId, ctx.user.id);
      const target = await shareBackTarget(ctx.user.id, input.storyId);
      const id = `shared-layout-${hash(
        JSON.stringify([target.tokenHash, ctx.user.id, input.operationToken])
      )}`;
      const requestHash = layoutRequestHash(input.layout);
      const author = await getStoryById(target.storyId, target.userId);
      const prior = readSharedLayoutState(
        (author?.body as Record<string, unknown> | null)?.sharedLayout
      ).candidates.find(row => row.id === id);
      if (prior) {
        if (prior.requestHash !== requestHash)
          throw new TRPCError({
            code: "CONFLICT",
            message: "这次分享已完成，请重新打开后再分享新版本",
          });
        return { submitted: true as const };
      }
      const authorName = artworkAuthorName(ctx.user.name);
      const stored = await storeLayoutForStory({
        userId: target.userId,
        storyId: target.storyId,
        authorName,
        layout: await sanitizeLayoutPackage(input.layout),
      });
      return writeSharedLayout(target.userId, target.storyId, state => {
        const existing = state.candidates.find(row => row.id === id);
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw new TRPCError({
              code: "CONFLICT",
              message: "这次分享已完成，请重新打开后再分享新版本",
            });
          return { state: null, result: { submitted: true as const } };
        }
        let candidates = state.candidates;
        if (candidates.length >= SHARED_LAYOUT_MAX_CANDIDATES) {
          // Make room by dropping the oldest version the author already handled.
          const handled = candidates.findIndex(row => row.status !== "pending");
          if (handled < 0)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "作者待查看的排版已满，请联系作者整理后再分享",
            });
          candidates = candidates.filter((_, index) => index !== handled);
        }
        return {
          state: {
            ...state,
            candidates: [
              ...candidates,
              {
                ...stored,
                id,
                requestHash,
                contributorUserId: ctx.user.id,
                createdAt: Date.now(),
                status: "pending",
              },
            ],
          },
          result: { submitted: true as const },
        };
      });
    }),
  /** The author marks a co-edited layout as adopted (applied in the editor) or ignored. */
  resolveLayoutCandidate: protectedProcedure
    .input(
      storyInput.extend({
        candidateId: z.string().min(1).max(200),
        status: z.enum(["adopted", "dismissed"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await own(input.storyId, ctx.user.id);
      return writeSharedLayout(ctx.user.id, input.storyId, state => {
        const candidate = state.candidates.find(
          row => row.id === input.candidateId
        );
        if (!candidate)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "这个排版版本已不存在",
          });
        if (candidate.status === input.status)
          return { state: null, result: { ok: true as const } };
        return {
          state: {
            ...state,
            candidates: state.candidates.map(row =>
              row.id === input.candidateId
                ? { ...row, status: input.status }
                : row
            ),
          },
          result: { ok: true as const },
        };
      });
    }),
});
