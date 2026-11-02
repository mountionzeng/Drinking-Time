import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const { createOrder } = vi.hoisted(() => ({ createOrder: vi.fn() }));
vi.mock("./repositories/computePayments", () => ({
  createComputePaymentOrder: createOrder,
  getOwnComputePaymentOrder: vi.fn(),
}));
import { computePaymentRouter } from "./routers/computePayment";

describe("configured Alipay top-up checkout", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("charges the server price and returns to the existing authenticated workspace", async () => {
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    for (const [key, value] of Object.entries({
      NODE_ENV: "production",
      APP_ORIGIN: "https://www.drinkingtime.top",
      ALIPAY_PC_CHECKOUT_ENABLED: "true",
      ALIPAY_APP_ID: "test-app",
      ALIPAY_MERCHANT_PID: "test-merchant",
      ALIPAY_APP_PRIVATE_KEY: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      ALIPAY_PUBLIC_KEY: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      ALIPAY_NOTIFY_URL: "https://www.drinkingtime.top/api/payments/alipay/notify",
    })) vi.stubEnv(key, value);

    const orderId = "00000000-0000-4000-8000-000000000011";
    createOrder.mockResolvedValue({ orderId });
    const caller = computePaymentRouter.createCaller({
      user: { id: 42, role: "user" }, req: { headers: {} }, res: {},
    } as TrpcContext);
    const result = await caller.createOrder({
      type: "topup", computeUnits: 1,
      requestId: "00000000-0000-4000-8000-000000000012",
    });
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42, amountFen: 100, creditMinor: 500_000, merchantId: "test-merchant",
    }));
    const checkout = new URL(result.checkoutUrl);
    expect(checkout.searchParams.get("return_url")).toBe("https://www.drinkingtime.top/m?payment=return");
    expect(JSON.parse(checkout.searchParams.get("biz_content")!)).toMatchObject({
      out_trade_no: orderId, total_amount: "1.00", product_code: "FAST_INSTANT_TRADE_PAY",
    });
  });
});
