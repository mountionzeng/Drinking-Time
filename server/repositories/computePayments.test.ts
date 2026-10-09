import { describe, expect, it, vi } from "vitest";
vi.mock("./runtime", () => ({ getDb: vi.fn(async () => null) }));
import {
  createComputePaymentOrder,
  paymentReceiptSchema,
  settleComputePayment,
} from "./computePayments";
const input = {
  userId: 1,
  requestId: "00000000-0000-4000-8000-000000000001",
  channel: "wechat" as const,
  merchantId: "merchant",
  amountFen: 1000,
  creditMinor: 10_000_000,
};
const receipt = {
  orderId: input.requestId,
  channel: input.channel,
  merchantId: input.merchantId,
  amountFen: 1000,
  currency: "CNY" as const,
  providerTransactionId: "transaction",
  paidAt: new Date(),
};
describe("payment persistence boundary", () => {
  it("refuses JSON persistence for real-money orders and receipts", async () => {
    await expect(createComputePaymentOrder(input)).rejects.toThrow(
      "PAYMENTS_REQUIRE_MYSQL"
    );
    await expect(settleComputePayment(receipt)).rejects.toThrow(
      "PAYMENTS_REQUIRE_MYSQL"
    );
  });
  it.each([0, -1, 1.2, NaN, Number.MAX_SAFE_INTEGER])(
    "rejects invalid channel fen %s",
    async amountFen => {
      await expect(
        createComputePaymentOrder({ ...input, amountFen })
      ).rejects.toThrow();
    }
  );
  it("rejects foreign currency, invalid dates, blank transaction IDs and injected owner/credit", () => {
    for (const bad of [
      { currency: "USD" },
      { paidAt: new Date(NaN) },
      { providerTransactionId: " " },
      { userId: 2 },
      { creditMinor: 99 },
    ]) {
      expect(
        paymentReceiptSchema.safeParse({ ...receipt, ...bad }).success
      ).toBe(false);
    }
  });
});
