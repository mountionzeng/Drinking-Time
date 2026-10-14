import { z } from "zod";
import { PUBLISHING_PLATFORM_IDS } from "./publishingDraft";
import { textDraftContentSchema } from "./textDraftHistory";

export const sharePermissionsSchema = z
  .object({
    rewrite: z.boolean(),
    fork: z.boolean(),
  })
  .strict();
export type SharePermissions = z.infer<typeof sharePermissionsSchema>;
export const VIEW_ONLY: SharePermissions = { rewrite: false, fork: false };
export const sharedWorkSchema = textDraftContentSchema.extend({
  platform: z.enum(PUBLISHING_PLATFORM_IDS),
});
export type SharedWork = z.infer<typeof sharedWorkSchema>;
export const shareContributionInput = z.object({
  operationToken: z.string().uuid(),
  content: textDraftContentSchema,
});
