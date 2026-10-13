import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createAlipayPagePayUrl,
  getAlipayConfig,
  verifyAlipaySignature,
} from "./alipay";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKey = keys.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const publicKey = keys.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const config = {
  appId: "2021007109633311",
  merchantPid: "2088test",
  appPrivateKey: privateKey,
  alipayPublicKey: publicKey,
  notifyUrl: "https://example.com/api/payments/alipay/notify",
  gateway: "https://openapi.alipay.com/gateway.do",
};
describe("Alipay PC checkout", () => {
  it("remains unavailable until every server-only credential is configured", () => {
    expect(
      getAlipayConfig({
        ALIPAY_PC_CHECKOUT_ENABLED: "true",
        ALIPAY_APP_ID: config.appId,
      })
    ).toBeNull();
  });
  it("creates a signed server-owned payment request", () => {
    const url = new URL(
      createAlipayPagePayUrl({
        config,
        orderId: "ab48d993-416b-4d98-b13a-621c63e21e7b",
        amountFen: 1990,
        subject: "20 算力月订阅",
        returnUrl: "https://example.com/account?payment=return",
      })
    );
    const parameters = Object.fromEntries(url.searchParams.entries());
    expect(parameters.app_id).toBe(config.appId);
    expect(JSON.parse(parameters.biz_content)).toMatchObject({
      total_amount: "19.90",
    });
    expect(verifyAlipaySignature(parameters, publicKey)).toBe(true);
  });
});
