import { z } from "zod";

/**
 * A whole editable layout page set shared between co-creators: the image-pack
 * settings, the module document and the pictures it uses. On the wire, images
 * are data URLs referenced by index ("layout-image:N"); once stored on a story
 * they become that story's own generated images.
 */
export const SHARED_LAYOUT_MAX_IMAGES = 12;
export const SHARED_LAYOUT_MAX_BYTES = 8 * 1024 * 1024;
export const SHARED_LAYOUT_MAX_CANDIDATES = 20;
export const LAYOUT_IMAGE_REF = /^layout-image:(\d{1,2})$/;
export const layoutImageRef = (index: number) => `layout-image:${index}`;

const number = z.number().finite();
const rectSchema = z.object({
  x: number,
  y: number,
  width: number.positive(),
  height: number.positive(),
});
const common = {
  id: z.string(),
  rect: rectSchema,
  positioned: z.boolean().optional(),
};
export const moduleSchema = z.discriminatedUnion("kind", [
  z.object({
    ...common,
    kind: z.literal("text"),
    text: z.string().max(12000),
    fontSize: number.min(8).max(240),
    contentWidth: number.positive(),
    contentHeight: number.positive(),
    alignment: z.enum(["start", "center"]),
    emphasis: z.enum(["normal", "bright"]).optional(),
    backdrop: z.boolean().optional(),
  }),
  z.object({
    ...common,
    kind: z.literal("image"),
    imageUrl: z.string(),
    crop: rectSchema,
  }),
]);
export const moduleDocumentSchema = z.object({
  version: z.literal(1),
  flowVersion: z.literal(1).optional(),
  pages: z
    .array(
      z.object({ label: z.string(), modules: z.array(moduleSchema).max(300) })
    )
    .min(1)
    .max(9),
});
export type ModuleRect = z.infer<typeof rectSchema>;
export type ImagePackModule = z.infer<typeof moduleSchema>;
export type ModuleDocument = z.infer<typeof moduleDocumentSchema>;

const imageIndex = z.number().int().min(0).max(SHARED_LAYOUT_MAX_IMAGES - 1);
const anchorSchema = z.object({
  text: z.string().max(4000),
  occurrence: z.number().int().min(0),
  matches: z.number().int().min(0),
});
export const sharedLayoutSettingsSchema = z.object({
  title: z.string().max(200).nullable(),
  style: z.string().max(40),
  fontId: z.string().max(80),
  texture: z.string().max(40),
  textureSeed: z.number().int().min(0).max(1_000_000_000),
  includeCover: z.boolean(),
  cover: imageIndex.nullable(),
  bodyTexture: imageIndex.nullable(),
  illustrations: z
    .array(z.object({ image: imageIndex, after: anchorSchema.nullable() }))
    .max(SHARED_LAYOUT_MAX_IMAGES),
});
export type SharedLayoutSettings = z.infer<typeof sharedLayoutSettingsSchema>;

function settingsIndexes(settings: SharedLayoutSettings) {
  return [
    settings.cover,
    settings.bodyTexture,
    ...settings.illustrations.map(item => item.image),
  ].filter((value): value is number => value != null);
}

export const sharedLayoutPackageSchema = z
  .object({
    settings: sharedLayoutSettingsSchema,
    modules: moduleDocumentSchema.nullable(),
    images: z
      .array(
        z
          .string()
          .max(4 * 1024 * 1024)
          .regex(/^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/)
      )
      .max(SHARED_LAYOUT_MAX_IMAGES),
  })
  .superRefine((value, ctx) => {
    if (
      value.images.reduce((size, image) => size + image.length, 0) >
      SHARED_LAYOUT_MAX_BYTES
    )
      ctx.addIssue({
        code: "custom",
        message: "排版图片总量不能超过 8 MB，请减少图片后重试",
      });
    const bad = (index: number) => index >= value.images.length;
    if (settingsIndexes(value.settings).some(bad))
      ctx.addIssue({ code: "custom", message: "排版引用了不存在的图片" });
    for (const page of value.modules?.pages ?? [])
      for (const module of page.modules) {
        if (module.kind !== "image") continue;
        const match = LAYOUT_IMAGE_REF.exec(module.imageUrl);
        if (!match || bad(Number(match[1])))
          ctx.addIssue({ code: "custom", message: "排版引用了不存在的图片" });
      }
  });
export type SharedLayoutPackage = z.infer<typeof sharedLayoutPackageSchema>;

/** Stored on a story: settings index into `assets`; modules use real image URLs. */
const storedLayoutSchema = z.object({
  authorName: z.string().max(80),
  settings: sharedLayoutSettingsSchema,
  modules: moduleDocumentSchema.nullable(),
  assets: z
    .array(z.object({ id: z.number().int(), imageUrl: z.string() }))
    .max(SHARED_LAYOUT_MAX_IMAGES),
});
export type StoredSharedLayout = z.infer<typeof storedLayoutSchema>;
const candidateSchema = storedLayoutSchema.extend({
  id: z.string(),
  requestHash: z.string(),
  contributorUserId: z.number().int(),
  createdAt: z.number(),
  status: z.enum(["pending", "adopted", "dismissed"]),
});
export type SharedLayoutCandidate = z.infer<typeof candidateSchema>;
export const sharedLayoutStateSchema = z.object({
  inherited: storedLayoutSchema.nullable().default(null),
  candidates: z.array(candidateSchema).default([]),
});
export type SharedLayoutState = z.infer<typeof sharedLayoutStateSchema>;

export function readSharedLayoutState(value: unknown): SharedLayoutState {
  const result = sharedLayoutStateSchema.safeParse(value ?? {});
  return result.success ? result.data : { inherited: null, candidates: [] };
}

/** What a story owner may see: no contributor ids or request hashes. */
export function publicSharedLayout(state: SharedLayoutState) {
  return {
    inherited: state.inherited,
    candidates: state.candidates.map(
      ({ requestHash: _hash, contributorUserId: _user, ...candidate }) =>
        candidate
    ),
  };
}
export type PublicSharedLayout = ReturnType<typeof publicSharedLayout>;
