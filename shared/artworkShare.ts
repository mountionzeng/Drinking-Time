import {
  sharePermissionsSchema,
  sharedWorkSchema,
  type SharePermissions,
  type SharedWork,
} from "./sharePermissions";
import { z } from "zod";
import {
  sharedLayoutPackageSchema,
  type SharedLayoutPackage,
} from "./sharedLayout";

export const ARTWORK_SHARE_MAX_PAGES = 9;
export const ARTWORK_SHARE_MAX_BYTES = 8 * 1024 * 1024;
export const artworkShareTokenSchema = z.string().uuid();
export type ArtworkSnapshot = {
  title: string;
  permissions?: SharePermissions;
  work?: SharedWork;
  author?: { name: string };
  pages: Array<{ dataUrl: string; width: number; height: number }>;
  /** Editable layout package. Server-only: never returned by the public read. */
  layout?: SharedLayoutPackage;
};
/** What anyone holding the link sees. */
export type PublicArtworkSnapshot = Omit<ArtworkSnapshot, "layout"> & {
  hasLayout: boolean;
};
export function artworkAuthorName(name?: string | null): string {
  const value = name?.trim();
  return !value || value === "Guest" ? "拾光创作者" : value.slice(0, 80);
}
export const artworkShareCreateSchema = z
  .object({
    permissions: sharePermissionsSchema.optional(),
    work: sharedWorkSchema.optional(),
    storyId: z.number().int().positive(),
    token: artworkShareTokenSchema,
    title: z.string().trim().min(1).max(200),
    pages: z
      .array(
        z
          .string()
          .max(4 * 1024 * 1024)
          .regex(/^data:image\/(png|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
      )
      .min(1)
      .max(ARTWORK_SHARE_MAX_PAGES),
    layout: sharedLayoutPackageSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.pages.reduce((size, page) => size + page.length, 0) >
      ARTWORK_SHARE_MAX_BYTES
    )
      ctx.addIssue({
        code: "custom",
        message: "分享图片总量不能超过 8 MB，请减少图片后重试",
      });
  });
