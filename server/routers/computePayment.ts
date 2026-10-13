import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createComputePaymentOrder,
  getOwnComputePaymentOrder,
} from "../repositories/computePayments";
import {
  computeSubscriptionPlans,
  getPublicComputeSubscriptionPlans,
} from "../services/computeSubscriptionPlans";
import {
  createAlipayPagePayUrl,
  getAlipayConfig,
} from "../services/payments/alipay";

const orderInput = z
  .object({ offerId: z.string().min(1).max(64), requestId: z.string().uuid() })
  .strict();
const recurringEnabled = () => process.env.ALIPAY_RECURRING_ENABLED === "true";
function appReturnUrl() {
  const origin = process.env.APP_ORIGIN?.trim();
  if (!origin) return null;
  try {
    const url = new URL("/account?payment=return", origin);
    return process.env.NODE_ENV === "production" && url.protocol !== "https:"
      ? null
      : url.toString();
  } catch {
    return null;
  }
}
function checkoutReady() {
  return Boolean(getAlipayConfig() && appReturnUrl());
}
function offerById(offerId: string) {
  return computeSubscriptionPlans.find(offer => offer.id === offerId) ?? null;
}

/** Separate from the read-only account router. Browser never asserts money, credit, or payment success. */
export const computePaymentRouter = router({
  availability: protectedProcedure.query(() => ({
    available: checkoutReady(),
    recurringEnabled: recurringEnabled(),
    message: checkoutReady()
      ? "选择套餐后前往支付宝安全付款。付款确认后算力到账。"
      : "支付宝收银台正在配置，当前不能签约或扣款。",
    contactEmail: "mountionzeng@gmail.com",
    plans: getPublicComputeSubscriptionPlans(),
  })),
  createOrder: protectedProcedure
    .input(orderInput.optional())
    .mutation(async ({ ctx, input }) => {
      const config = getAlipayConfig();
      const returnUrl = appReturnUrl();
      if (!config || !returnUrl)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "支付宝收银台暂不可用，未创建订单。",
        });
      if (!input)
        throw new TRPCError({ code: "BAD_REQUEST", message: "请选择套餐。" });
      const offer = offerById(input.offerId);
      if (!offer)
        throw new TRPCError({ code: "BAD_REQUEST", message: "未找到此套餐。" });
      try {
        const order = await createComputePaymentOrder({
          userId: ctx.user.id,
          requestId: input.requestId,
          channel: "alipay",
          merchantId: config.merchantPid,
          amountFen: offer.amountFen,
          creditMinor: offer.creditMinor,
        });
        return {
          orderId: order.orderId,
          checkoutUrl: createAlipayPagePayUrl({
            config,
            orderId: order.orderId,
            amountFen: offer.amountFen,
            subject: offer.name,
            returnUrl,
          }),
        };
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "PAYMENTS_REQUIRE_MYSQL"
        )
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "支付服务暂不可用，未创建订单。",
          });
        throw error;
      }
    }),
  order: protectedProcedure
    .input(z.object({ orderId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) =>
      getOwnComputePaymentOrder(ctx.user.id, input.orderId)
    ),
});
