import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { listAdminComputeUsers } from "../repositories/adminCompute";
import { getUserById } from "../repositories/users";
import { getAccountStatement } from "../services/computeStatement";

export const adminComputeRouter = router({
  users: adminProcedure
    .input(
      z.object({
        email: z.string().trim().email().max(320).optional(),
        offset: z.number().int().min(0).max(100000).default(0),
        limit: z.number().int().min(1).max(100).default(25),
      })
    )
    .query(({ input }) => listAdminComputeUsers(input)),
  statement: adminProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        historyOffset: z.number().int().min(0).max(500).default(0),
        attentionOffset: z.number().int().min(0).max(500).default(0),
      })
    )
    .query(async ({ input }) => {
      if (!(await getUserById(input.userId)))
        throw new TRPCError({ code: "NOT_FOUND" });
      return getAccountStatement(input.userId, {
        historyOffset: input.historyOffset,
        attentionOffset: input.attentionOffset,
        historyLimit: 25,
        attentionLimit: 25,
      });
    }),
});
