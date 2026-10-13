import { Router } from "express";
import {
  getAlipayConfig,
  verifyAlipaySignature,
} from "../services/payments/alipay";
import { settleComputePayment } from "../repositories/computePayments";

/** Alipay posts application/x-www-form-urlencoded notifications, outside browser origin checks. */
export function createAlipayNotifyRoute() {
  const router = Router();
  router.post("/payments/alipay/notify", async (req, res) => {
    const config = getAlipayConfig();
    if (!config) return res.status(503).send("failure");
    const params = Object.fromEntries(
      Object.entries(req.body ?? {}).map(([key, value]) => [
        key,
        typeof value === "string" ? value : "",
      ])
    );
    if (!verifyAlipaySignature(params, config.alipayPublicKey))
      return res.status(400).send("failure");
    if (
      params.app_id !== config.appId ||
      params.seller_id !== config.merchantPid ||
      params.trade_status !== "TRADE_SUCCESS"
    )
      return res.status(400).send("failure");
    const amount = String(params.total_amount ?? "");
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
    const amountFen = match
      ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"))
      : NaN;
    if (
      !Number.isSafeInteger(amountFen) ||
      !params.out_trade_no ||
      !params.trade_no
    )
      return res.status(400).send("failure");
    try {
      await settleComputePayment({
        orderId: params.out_trade_no,
        channel: "alipay",
        merchantId: config.merchantPid,
        amountFen,
        currency: "CNY",
        providerTransactionId: params.trade_no,
        paidAt: new Date(params.gmt_payment ?? Date.now()),
      });
      return res.type("text/plain").send("success");
    } catch {
      // Provider retries only when it does not receive success. Never disclose order data.
      return res.status(500).send("failure");
    }
  });
  return router;
}
