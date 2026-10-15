import { createSign, createVerify } from "node:crypto";

export type AlipayConfig = Readonly<{
  appId: string;
  merchantPid: string;
  appPrivateKey: string;
  alipayPublicKey: string;
  notifyUrl: string;
  gateway: string;
}>;

const canonical = (params: Record<string, string>) =>
  Object.keys(params)
    .filter(key => key !== "sign" && params[key] !== "")
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join("&");

function readKey(value: string) {
  return value.replace(/\\n/g, "\n").trim();
}

/** Only reports readiness; it never returns secret material to callers. */
export function getAlipayConfig(env = process.env): AlipayConfig | null {
  if (env.ALIPAY_PC_CHECKOUT_ENABLED !== "true") return null;
  const appId = env.ALIPAY_APP_ID?.trim() ?? "";
  const merchantPid = env.ALIPAY_MERCHANT_PID?.trim() ?? "";
  const appPrivateKey = readKey(env.ALIPAY_APP_PRIVATE_KEY ?? "");
  const alipayPublicKey = readKey(env.ALIPAY_PUBLIC_KEY ?? "");
  const notifyUrl = env.ALIPAY_NOTIFY_URL?.trim() ?? "";
  if (
    !appId ||
    !merchantPid ||
    !appPrivateKey ||
    !alipayPublicKey ||
    !notifyUrl
  )
    return null;
  try {
    new URL(notifyUrl);
  } catch {
    return null;
  }
  return {
    appId,
    merchantPid,
    appPrivateKey,
    alipayPublicKey,
    notifyUrl,
    gateway:
      env.ALIPAY_GATEWAY?.trim() || "https://openapi.alipay.com/gateway.do",
  };
}

function sign(params: Record<string, string>, privateKey: string) {
  const signer = createSign("RSA-SHA256");
  signer.update(canonical(params), "utf8");
  signer.end();
  return signer.sign(privateKey, "base64");
}

/** Server generated redirect only. Money and user identity stay server-side. */
export function createAlipayPagePayUrl(input: {
  config: AlipayConfig;
  orderId: string;
  amountFen: number;
  subject: string;
  returnUrl: string;
}) {
  const params: Record<string, string> = {
    app_id: input.config.appId,
    method: "alipay.trade.page.pay",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: new Date()
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, ""),
    version: "1.0",
    notify_url: input.config.notifyUrl,
    return_url: input.returnUrl,
    biz_content: JSON.stringify({
      out_trade_no: input.orderId,
      product_code: "FAST_INSTANT_TRADE_PAY",
      total_amount: (input.amountFen / 100).toFixed(2),
      subject: input.subject,
    }),
  };
  const url = new URL(input.config.gateway);
  for (const [key, value] of Object.entries({
    ...params,
    sign: sign(params, input.config.appPrivateKey),
  }))
    url.searchParams.set(key, value);
  return url.toString();
}

export function verifyAlipaySignature(
  params: Record<string, string>,
  publicKey: string
) {
  const signature = params.sign;
  if (!signature) return false;
  const verifier = createVerify("RSA-SHA256");
  // Alipay notifications exclude sign_type; outgoing API requests include it.
  const { sign_type: _signType, ...notificationParams } = params;
  verifier.update(canonical(notificationParams), "utf8");
  verifier.end();
  return verifier.verify(publicKey, signature, "base64");
}
