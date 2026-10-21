import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { adminUserCategories } from "../../shared/adminUsers";
import {
  getAdminUsersOverview,
  setAdminUserCategory,
} from "../repositories/adminUsers";

export const adminUsersRouter = router({
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
