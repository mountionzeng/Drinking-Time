import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { acceptClientActivity, activityForAccount, activityFunnel } from "../services/activityJourney";

export const activityJourneyRouter = router({
  record: protectedProcedure
    .input(z.unknown())
    .mutation(async ({ ctx, input }) => {
      const outcome = await acceptClientActivity({
        userId: ctx.user.id,
        platform: "web",
        body: input,
      });
      if (outcome === "invalid") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能记录这个操作" });
      }
      if (outcome === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "没有可查看的结果" });
      }
      if (outcome === "limited") {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "操作记录过于频繁" });
      }
      return { outcome: outcome === "dropped" ? "dropped" : outcome };
    }),
  funnel: adminProcedure
    .input(z.object({ sinceDays: z.number().int().min(1).max(180) }).strict())
    .query(({ input }) => activityFunnel(input.sinceDays)),
  account: adminProcedure
    .input(z.object({ userId: z.number().int().positive() }).strict())
    .query(({ input }) => activityForAccount(input.userId)),
});
