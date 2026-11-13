import { TRPCError } from "@trpc/server";
import type { MailboxPackage } from "../repositories/storyMailboxPackage";
export type MailboxMaps = {
  urls?: Map<string, string>;
  images: Map<number, number>;
  videos: Map<number, number>;
  ranges: Map<number, number>;
  audio: Map<number, number>;
};
const imageKeys = new Set([
  "imageId",
  "sourceImageId",
  "parentImageId",
  "referencedImageId",
  "leftImageId",
  "rightImageId",
  "referenceImageId",
  "continuityImageId",
  "publishingReferenceImageId",
  "publishingContinuityImageId",
]);
const imageArrays = new Set([
  "imageIds",
  "relatedImageIds",
  "referenceImageIds",
  "publishingReferenceImageIds",
]);
/** Rebind typed asset references, leaving clip identities, frames and historical authors intact. */
export function remapMailboxValue(
  value: unknown,
  maps: MailboxMaps,
  storyId: number,
  userId: number,
  key = ""
): unknown {
  const mapped = (map: Map<number, number>, id: number) => {
    const next = map.get(id);
    if (next === undefined)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `故事中有缺失或尚未完成的素材（${key || "素材"}），没有创建不完整副本`,
      });
    return next;
  };
  if (typeof value === "number") {
    if (key === "userId") return userId;
    if (key === "storyId") return storyId;
    if (imageKeys.has(key)) return mapped(maps.images, value);
    if (key === "takeId" || key === "sourceTakeId")
      return mapped(maps.videos, value);
    if (key === "rangeId" || key === "selectedRangeId")
      return mapped(maps.ranges, value);
    if (key === "assetId" || key === "audioAssetId" || key === "sourceAssetId")
      return value < 0 ? value : mapped(maps.audio, value);
    return value;
  }
  if (typeof value === "string") {
    if (maps.urls?.has(value)) return maps.urls.get(value)!;
    if (key === "sourceId" && /^image-\d+$/.test(value))
      return `image-${mapped(maps.images, Number(value.slice(6)))}`;
    const withStoryAudio = value.replace(
      /\/api\/story-audio\/\d+\//g,
      `/api/story-audio/${storyId}/`
    );
    return withStoryAudio.replace(
      /\/api\/story-audio-asset\/\d+\/(\d+)/g,
      (_match, id) =>
        `/api/story-audio-asset/${storyId}/${mapped(maps.audio, Number(id))}`
    );
  }
  if (Array.isArray(value))
    return value.map(v =>
      typeof v === "number" && imageArrays.has(key)
        ? mapped(maps.images, v)
        : remapMailboxValue(v, maps, storyId, userId, key)
    );
  if (value && typeof value === "object") {
    if (value instanceof Date) return value;
    const row = value as Record<string, unknown>,
      out: Record<string, unknown> = {};
    for (const [field, v] of Object.entries(row)) {
      // Historical display attribution has no authority and must never become the receiver's identity.
      if (field === "userId" && typeof row.name === "string") {
        out.userId = 0;
        continue;
      }
      if (field === "authorUserId") {
        out.authorUserId = 0;
        continue;
      }
      if (
        field === "assetId" &&
        typeof v === "number" &&
        (key === "illustrations" ||
          key === "cover" ||
          "after" in row ||
          "sourceCoreRevision" in row)
      ) {
        out[field] = mapped(maps.images, v);
        continue;
      }
      if (field === "projectId") {
        out.projectId = null;
        continue;
      }
      if (field === "id" && typeof v === "number") {
        if ("imageUrl" in row) {
          out.id = mapped(maps.images, v);
          continue;
        }
        if ("videoUrl" in row && "status" in row) {
          out.id = mapped(maps.videos, v);
          continue;
        }
        if ("takeId" in row && "startSec" in row) {
          out.id = mapped(maps.ranges, v);
          continue;
        }
      }
      if (field === "imageTransforms" || field === "imageTextOverlays") {
        out[field] = Object.fromEntries(
          Object.entries((v ?? {}) as Record<string, unknown>).map(
            ([id, entry]) => [mapped(maps.images, Number(id)), entry]
          )
        );
        continue;
      }
      out[field] = remapMailboxValue(v, maps, storyId, userId, field);
    }
    return out;
  }
  return value;
}
/** Validate every nested current/history reference before publishing an envelope. */
export function validateMailboxReferences(pkg: MailboxPackage) {
  const identity = (rows: { id: number }[]) =>
    new Map(rows.map(r => [r.id, r.id]));
  const maps = {
    images: identity(pkg.images),
    videos: identity(pkg.videos),
    ranges: identity(pkg.ranges),
    audio: identity(pkg.audio),
  };
  remapMailboxValue(
    [
      pkg.body,
      pkg.timeline,
      pkg.chapters,
      pkg.chapterVersions,
      pkg.ranges,
      pkg.selections,
      pkg.videos,
    ],
    maps,
    0,
    0
  );
}
