import { createSign, createVerify, generateKeyPairSync } from "node:crypto";
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
    // Outgoing OpenAPI requests include sign_type, unlike payment notifications.
    const content = Object.keys(parameters)
      .filter(key => key !== "sign")
      .sort()
      .map(key => `${key}=${parameters[key]}`)
      .join("&");
    expect(
      createVerify("RSA-SHA256")
        .update(content)
        .verify(publicKey, parameters.sign, "base64")
    ).toBe(true);
  });
  it("verifies notifications without sign_type and rejects altered amounts", () => {
    const params = {
      out_trade_no: "order-1",
      total_amount: "19.90",
      trade_status: "TRADE_SUCCESS",
    };
    const content = Object.keys(params)
      .sort()
      .map(key => `${key}=${params[key as keyof typeof params]}`)
      .join("&");
    const sign = createSign("RSA-SHA256")
      .update(content)
      .sign(privateKey, "base64");
    const notification = { ...params, sign_type: "RSA2", sign };
    expect(verifyAlipaySignature(notification, publicKey)).toBe(true);
    expect(
      verifyAlipaySignature(
        { ...notification, total_amount: "199.00" },
        publicKey
      )
    ).toBe(false);
  });
});
