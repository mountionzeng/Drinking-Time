import { createHash } from "node:crypto";
import sharp from "sharp";
import { TRPCError } from "@trpc/server";
import { getStoryById } from "../repositories/stories";
import {
  createGeneratedImage,
  getGeneratedImageByStoryAndImageKey,
} from "../repositories/images";
import { storeImageBytes } from "./imageGen";

const pending = new Map<string, Promise<unknown>>();
/** Serialize retries; content keys recover partially saved batches after restart. */
export async function archiveArtwork(input: {
  storyId: number;
  userId: number;
  title: string;
  pages: string[];
}) {
  const scope = `${input.userId}:${input.storyId}`;
  const previous = pending.get(scope) ?? Promise.resolve();
  const task = previous
    .catch(() => {})
    .then(async () => {
      const story = await getStoryById(input.storyId, input.userId);
      if (!story)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "故事不存在或无权访问",
        });
      const pages = await Promise.all(
        input.pages.map(async page => {
          try {
            const image = sharp(
              Buffer.from(page.slice(page.indexOf(",") + 1), "base64"),
              { limitInputPixels: 4_000_000, animated: false }
            );
            const meta = await image.metadata();
            if (
              !meta.width ||
              !meta.height ||
              (meta.pages ?? 1) > 1 ||
              !["png", "webp"].includes(meta.format ?? "")
            )
              throw new Error();
            return await image.webp({ quality: 95 }).toBuffer();
          } catch {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "成品图片无法读取，请重新排版",
            });
          }
        })
      );
      const imageIds: number[] = [];
      for (const [index, bytes] of pages.entries()) {
        const digest = createHash("sha256").update(bytes).digest("hex");
        const key = `generated/artwork/${input.userId}/${input.storyId}/${digest}.webp`;
        const existing = await getGeneratedImageByStoryAndImageKey(
          input.storyId,
          input.userId,
          key
        );
        if (existing) {
          imageIds.push(existing.id);
          continue;
        }
        const stored = await storeImageBytes(bytes, "image/webp", {
          storageKey: key,
        });
        if (stored.status !== "ok" || !stored.imageUrl)
          throw new Error("成品保存失败，请重试；已保存的页面会保留");
        const row = await createGeneratedImage({
          storyId: input.storyId,
          userId: input.userId,
          projectId: story.projectId,
          imageKey: key,
          imageUrl: stored.imageUrl,
          shotNo: null,
          prompt: `排版成品 · ${input.title} · 第${index + 1}页`,
          generationType: "initial",
          isCurrent: false,
        });
        imageIds.push(row.id);
      }
      return { imageIds };
    });
  pending.set(scope, task);
  try {
    return await task;
  } finally {
    if (pending.get(scope) === task) pending.delete(scope);
  }
}
