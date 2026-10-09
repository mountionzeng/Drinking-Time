import { createHash, createHmac } from "node:crypto";
import axios from "axios";

export function phoneSmsConfig() {
  return {
    enabled: process.env.PHONE_LOGIN_ENABLED === "true",
    secretId: process.env.TENCENT_SMS_SECRET_ID?.trim() ?? "",
    secretKey: process.env.TENCENT_SMS_SECRET_KEY?.trim() ?? "",
    appId: process.env.TENCENT_SMS_APP_ID?.trim() ?? "",
    signName: process.env.TENCENT_SMS_SIGN_NAME?.trim() ?? "",
    templateId: process.env.TENCENT_SMS_TEMPLATE_ID?.trim() ?? "",
    region: process.env.TENCENT_SMS_REGION?.trim() || "ap-guangzhou",
    digestSecret: process.env.PHONE_OTP_DIGEST_SECRET?.trim() ?? "",
  };
}

export function phoneSmsConfigured() {
  const c = phoneSmsConfig();
  return (
    (process.env.NODE_ENV !== "production" ||
      !!process.env.DATABASE_URL?.trim()) &&
    c.enabled &&
    !!c.secretId &&
    !!c.secretKey &&
    /^\d+$/.test(c.appId) &&
    !!c.signName &&
    /^\d+$/.test(c.templateId) &&
    c.digestSecret.length >= 32
  );
}

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) =>
  createHmac("sha256", key).update(value).digest();

/** Tencent Cloud TC3 signature. Fixed host; no caller-controlled outbound URL. */
export function smsAuthorization(
  payload: string,
  timestamp: number,
  secretId: string,
  secretKey: string
) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const scope = `${date}/sms/tc3_request`;
  const headers =
    "content-type:application/json; charset=utf-8\nhost:sms.tencentcloudapi.com\nx-tc-action:sendsms\n";
  const signedHeaders = "content-type;host;x-tc-action";
  const canonical = `POST\n/\n\n${headers}\n${signedHeaders}\n${sha256(payload)}`;
  const toSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonical)}`;
  const key = hmac(hmac(hmac(`TC3${secretKey}`, date), "sms"), "tc3_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

export async function sendPhoneLoginSms(phone: string, code: string) {
  const c = phoneSmsConfig();
  if (!phoneSmsConfigured()) throw new Error("sms_not_configured");
  const payload = JSON.stringify({
    PhoneNumberSet: [phone],
    SmsSdkAppId: c.appId,
    SignName: c.signName,
    TemplateId: c.templateId,
    TemplateParamSet: [code],
  });
  const timestamp = Math.floor(Date.now() / 1000);
  // No automatic retry: a timeout can mean the paid SMS was already accepted.
  try {
    const { data } = await axios.post(
      "https://sms.tencentcloudapi.com/",
      payload,
      {
        timeout: 10_000,
        maxRedirects: 0,
        maxContentLength: 64 * 1024,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-TC-Action": "SendSms",
          "X-TC-Version": "2021-01-11",
          "X-TC-Timestamp": String(timestamp),
          "X-TC-Region": c.region,
          Authorization: smsAuthorization(
            payload,
            timestamp,
            c.secretId,
            c.secretKey
          ),
        },
      }
    );
    const statuses = data?.Response?.SendStatusSet;
    if (
      data?.Response?.Error ||
      !Array.isArray(statuses) ||
      statuses.length !== 1 ||
      statuses[0]?.Code !== "Ok" ||
      statuses[0]?.PhoneNumber !== phone
    )
      throw new Error("rejected");
  } catch {
    // Axios errors contain credentials and the SMS body. Never pass them to logs or clients.
    throw new Error("sms_send_failed");
  }
}
