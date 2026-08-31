import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  CREATOR_SEASONAL_PROFILES,
  isValidIanaTimeZone,
} from "../../shared/creatorVisualPreferences";
import {
  clearCreatorVisualPreferenceIfRevision,
  getCreatorVisualPreference,
  writeCreatorVisualPreferenceIfRevision,
} from "../db";
import { protectedProcedure, router } from "../_core/trpc";

const expectedRevisionSchema = z.number().int().nonnegative();
const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidIanaTimeZone, "无效的 IANA 时区");

function publicValue(
  row: Awaited<ReturnType<typeof getCreatorVisualPreference>>
) {
  return row
    ? {
        seasonalProfile: row.seasonalProfile,
        timeZone: row.timeZone,
        source: row.source,
        revision: row.revision,
        saved: true as const,
        updatedAt: row.updatedAt.toISOString(),
      }
    : {
        seasonalProfile: "unknown" as const,
        timeZone: null,
        source: "cleared" as const,
        revision: 0,
        saved: false as const,
        updatedAt: null,
      };
}

async function conflict(userId: number): Promise<never> {
  const latest = await getCreatorVisualPreference(userId);
  throw new TRPCError({
    code: "CONFLICT",
    message: `设置已在别处更新（当前版本 ${latest?.revision ?? 0}），请重新加载后再保存`,
  });
}

export const creatorVisualPreferencesRouter = router({
  read: protectedProcedure.query(async ({ ctx }) =>
    publicValue(await getCreatorVisualPreference(ctx.user.id))
  ),

  save: protectedProcedure
    .input(
      z
        .object({
          expectedRevision: expectedRevisionSchema,
          seasonalProfile: z.enum(CREATOR_SEASONAL_PROFILES),
          timeZone: timeZoneSchema.nullable(),
          source: z.enum(["manual", "browser_confirmed"]),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      const row = await writeCreatorVisualPreferenceIfRevision({
        ...input,
        userId: ctx.user.id,
      });
      if (!row) return conflict(ctx.user.id);
      return publicValue(row);
    }),

  clear: protectedProcedure
    .input(z.object({ expectedRevision: expectedRevisionSchema }).strict())
    .mutation(async ({ ctx, input }) => {
      const row = await clearCreatorVisualPreferenceIfRevision({
        userId: ctx.user.id,
        expectedRevision: input.expectedRevision,
      });
      if (!row) return conflict(ctx.user.id);
      return publicValue(row);
    }),
});
