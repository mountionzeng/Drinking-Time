import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { adminUserCategories } from "../../shared/adminUsers";
import {
  getAdminUsersOverview,
  setAdminUserCategory,
} from "../repositories/adminUsers";

import { activitySignal, activityWindow } from "../../shared/activityJourney";
import { readActivityReport, recordActivitySignal } from "../repositories/activityJourney";
import { activityReportCsv } from "../services/activityJourneyReport";

export const adminUsersRouter = router({
  journeySignal: protectedProcedure.input(activitySignal).mutation(async ({ input, ctx }) => {
    await recordActivitySignal(ctx.user.id, input);
    return { received: true };
  }),
  journeySummary: adminProcedure.input(activityWindow).query(({ input }) => readActivityReport(input)),
  journeyExport: adminProcedure.input(activityWindow).query(async ({ input }) =>
    activityReportCsv(await readActivityReport(input))),
  overview: adminProcedure
    .input(z.object({ siteHost: z.string().trim().min(1).max(255) }))
    .query(({ input }) => getAdminUsersOverview(input.siteHost.toLowerCase())),
  setCategory: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        category: z.enum(adminUserCategories),
      })
    )
    .mutation(({ input, ctx }) =>
      setAdminUserCategory(input.userId, input.category, ctx.user.id)
    ),
});
