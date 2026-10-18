import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getPublicComputeSubscriptionPlans } from "../services/computeSubscriptionPlans";

/** Separate from the read-only account router. No client can assert payment. */
export const computePaymentRouter = router({
  availability: protectedProcedure.query(() => ({
    available: false as const,
    message:
      "支付宝自动续费尚未开放，当前不能签约或扣款。如需算力，请联系支持。",
    contactEmail: "mountionzeng@gmail.com",
    plans: getPublicComputeSubscriptionPlans(),
  })),
  // Fail closed until merchant integration, approved offers and live acceptance.
  createOrder: protectedProcedure.mutation(() => {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "在线充值尚未开放，未创建支付订单。",
    });
  }),
});
