import { activityWebVisit, readActivityWebVisit } from "../services/activityJourneyContext";
import { inferenceFailureMessage } from "@shared/inferenceFailureMessage";
import { withComputeUser } from "../services/computeRequestAccess";
import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape }) => ({ ...shape, message: inferenceFailureMessage(shape.message) }),
});

export const router = t.router;
const baseProcedure = t.procedure.use(({ ctx, next, type }) => {
  const visit = type === "mutation" ? readActivityWebVisit(ctx.user?.id, ctx.req?.headers) : undefined;
  return activityWebVisit.run(visit, () => withComputeUser(ctx.user?.id ?? null, () => next()));
}
);
export const publicProcedure = baseProcedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = baseProcedure.use(requireUser);

export const adminProcedure = baseProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
