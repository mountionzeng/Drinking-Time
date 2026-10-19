import { createHash } from "node:crypto";
import sharp from "sharp";
import { TRPCError } from "@trpc/server";
import {
  getStoryById,
  updateStoryBodyIfRevision,
} from "../repositories/stories";
import {
  createGeneratedImage,
  getGeneratedImageByStoryAndImageKey,
} from "../repositories/images";
import { storeImageBytes } from "./imageGen";
import { getStoryRevision, prepareStoryBody } from "./storySync";
import {
  LAYOUT_IMAGE_REF,
  readSharedLayoutState,
  type SharedLayoutPackage,
  type SharedLayoutState,
  type StoredSharedLayout,
} from "../../shared/sharedLayout";

const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const unreadable = () =>
  new TRPCError({
    code: "BAD_REQUEST",
    message: "排版图片无法读取或尺寸过大，请重新选择图片后分享",
  });

/** Decode and re-encode every picture: no foreign URLs, SVG, EXIF or metadata survive. */
export async function sanitizeLayoutPackage(
  layout: SharedLayoutPackage
): Promise<SharedLayoutPackage> {
  const images: string[] = [];
  for (const dataUrl of layout.images) {
    try {
      const image = sharp(
        Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"),
        { limitInputPixels: 6_000_000, animated: false }
      );
      const meta = await image.metadata();
      if (
        !meta.width ||
        !meta.height ||
        (meta.pages ?? 1) > 1 ||
        !["png", "webp", "jpeg"].includes(meta.format ?? "")
      )
        throw new Error("Invalid image");
      const data = await image
        .rotate()
        .resize({
          width: 1600,
          height: 1600,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 90 })
        .toBuffer();
      images.push(`data:image/webp;base64,${data.toString("base64")}`);
    } catch {
      throw unreadable();
    }
  }
  return { ...structuredClone(layout), images };
}

const pending = new Map<string, Promise<unknown>>();
/** Serialize image copies per story so retries never create duplicate rows. */
function serialized<T>(scope: string, run: () => Promise<T>): Promise<T> {
  const task = (pending.get(scope) ?? Promise.resolve())
    .catch(() => {})
    .then(run);
  pending.set(scope, task);
  return task.finally(() => {
    if (pending.get(scope) === task) pending.delete(scope);
  });
}

/** Copy a sanitized package's pictures into the target story's own library. */
export function storeLayoutForStory(input: {
  userId: number;
  storyId: number;
  authorName: string;
  layout: SharedLayoutPackage;
}): Promise<StoredSharedLayout> {
  return serialized(`${input.userId}:${input.storyId}`, async () => {
    const story = await getStoryById(input.storyId, input.userId);
    if (!story)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "故事不存在或分享已停止",
      });
    const assets: StoredSharedLayout["assets"] = [];
    for (const dataUrl of input.layout.images) {
      const bytes = Buffer.from(
        dataUrl.slice(dataUrl.indexOf(",") + 1),
        "base64"
      );
      const key = `generated/shared-layout/${input.userId}/${input.storyId}/${sha(bytes)}.webp`;
      const existing = await getGeneratedImageByStoryAndImageKey(
        input.storyId,
        input.userId,
        key
      );
      if (existing) {
        assets.push({ id: existing.id, imageUrl: existing.imageUrl });
        continue;
      }
      const stored = await storeImageBytes(bytes, "image/webp", {
        storageKey: key,
      });
      if (stored.status !== "ok" || !stored.imageUrl)
        throw new Error("排版图片保存失败，请重试");
      const row = await createGeneratedImage({
        storyId: input.storyId,
        userId: input.userId,
        projectId: story.projectId,
        imageKey: key,
        imageUrl: stored.imageUrl,
        shotNo: null,
        prompt: `来自${input.authorName}的排版图片`,
        generationType: "initial",
        isCurrent: false,
      });
      assets.push({ id: row.id, imageUrl: row.imageUrl ?? stored.imageUrl });
    }
    const modules = input.layout.modules
      ? {
          ...input.layout.modules,
          pages: input.layout.modules.pages.map(page => ({
            ...page,
            modules: page.modules.map(module =>
              module.kind === "image"
                ? {
                    ...module,
                    imageUrl:
                      assets[Number(LAYOUT_IMAGE_REF.exec(module.imageUrl)![1])]
                        .imageUrl,
                  }
                : module
            ),
          })),
        }
      : null;
    return {
      authorName: input.authorName,
      settings: input.layout.settings,
      modules,
      assets,
    };
  });
}

/**
 * Compare-and-swap the server-owned `sharedLayout` body field. `update` returns
 * null when nothing needs writing (replays).
 */
export async function writeSharedLayout<T>(
  userId: number,
  storyId: number,
  update: (state: SharedLayoutState) => { state: SharedLayoutState | null; result: T }
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const story = await getStoryById(storyId, userId);
    if (!story)
      throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在或无权访问" });
    const body = structuredClone(
      (story.body ?? {}) as Record<string, unknown>
    );
    const { state, result } = update(readSharedLayoutState(body.sharedLayout));
    if (!state) return result;
    body.sharedLayout = state;
    const revision = getStoryRevision(story.body);
    const prepared = prepareStoryBody(body, revision + 1, body);
    if (Buffer.byteLength(JSON.stringify(prepared), "utf8") > 5_000_000)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "故事容量已满，请先整理旧的排版版本",
      });
    if (
      await updateStoryBodyIfRevision({
        id: storyId,
        userId,
        expectedRevision: revision,
        body: prepared,
      })
    )
      return result;
  }
  throw new TRPCError({
    code: "CONFLICT",
    message: "故事正在保存，请稍后重试",
  });
}

export const layoutRequestHash = (layout: SharedLayoutPackage) =>
  sha(JSON.stringify(layout));
