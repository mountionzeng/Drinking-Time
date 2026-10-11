import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { creationOwnerSchema } from "./textSourceLineage";
import {
  requestCandidateSchema,
  requestCandidate,
  inspectCandidate,
  inspectCandidates,
  confirmCandidate,
  adoptCandidate,
  discardCandidate,
} from "../services/downstreamRegenerationCandidates";
const candidate = creationOwnerSchema.extend({
  candidateId: z.string().uuid(),
});
const mutation = candidate.extend({
  expectedRevision: z.number().int().nonnegative(),
});
const session = mutation.extend({ sessionId: z.string().min(8).max(100) });
export const downstreamRegenerationRouter = router({
  list: protectedProcedure
    .input(creationOwnerSchema)
    .query(({ input, ctx }) =>
      inspectCandidates({ ...input, userId: ctx.user.id })
    ),
  read: protectedProcedure
    .input(candidate)
    .query(({ input, ctx }) =>
      inspectCandidate({ ...input, userId: ctx.user.id }, input.candidateId)
    ),
  request: protectedProcedure
    .input(requestCandidateSchema)
    .mutation(({ input, ctx }) =>
      requestCandidate({ ...input, userId: ctx.user.id })
    ),
  confirm: protectedProcedure
    .input(session)
    .mutation(({ input, ctx }) =>
      confirmCandidate({ ...input, userId: ctx.user.id })
    ),
  adopt: protectedProcedure
    .input(session.extend({ confirmationToken: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      adoptCandidate({ ...input, userId: ctx.user.id })
    ),
  discard: protectedProcedure
    .input(mutation)
    .mutation(({ input, ctx }) =>
      discardCandidate({ ...input, userId: ctx.user.id })
    ),
});
