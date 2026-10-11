import { protectedProcedure, router } from "../_core/trpc";
import {
  creationFlowRequestSchema,
  creationFlowProposalSchema,
} from "../../shared/creationFlowCommand";
import {
  runCreationFlow,
  executeCreationFlow,
} from "../services/creationFlowCommands";
export const creationFlowRouter = router({
  run: protectedProcedure
    .input(creationFlowRequestSchema)
    .mutation(({ input, ctx }) =>
      runCreationFlow({ ...input, userId: ctx.user.id })
    ),
  execute: protectedProcedure
    .input(
      creationFlowRequestSchema.extend({ proposal: creationFlowProposalSchema })
    )
    .mutation(({ input, ctx }) =>
      executeCreationFlow({ ...input, userId: ctx.user.id }, input.proposal)
    ),
});
