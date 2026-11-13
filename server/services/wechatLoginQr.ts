import sharp from "sharp";
import { z } from "zod";
import {
  authorityRequest,
  isShiguangStoryAuthorityConfigured,
} from "./shiguangStoryAuthorityClient";

export const wechatLoginQrConfigured = () =>
  process.env.WECHAT_LOGIN_QR_ENABLED === "true" &&
  isShiguangStoryAuthorityConfigured({ enabled: true });

/** The mini-program cloud function owns AppSecret; browser verifier never leaves the web server. */
export async function createWechatLoginQr(
  code: string,
  expiresAt: Date,
  request = authorityRequest,
  purpose?: "mailbox"
) {
  if (!/^[A-F0-9]{28}$/.test(code) || expiresAt.getTime() <= Date.now())
    throw new Error("wechat_qr_request_invalid");
  const response = await request(
    "/v1/web-login/qr",
    { code, expiresAt: expiresAt.getTime(), ...(purpose ? { purpose } : {}) },
    {
      enabled: wechatLoginQrConfigured(),
      maxResponseBytes: 1_500_000,
    }
  );
  const { base64 } = z
    .object({
      base64: z
        .string()
        .min(1)
        .max(1_400_000)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    })
    .strict()
    .parse(response);
  const bytes = Buffer.from(base64, "base64");
  const metadata = await sharp(bytes, {
    limitInputPixels: 1_000_000,
  }).metadata();
  if (
    !["png", "jpeg"].includes(metadata.format ?? "") ||
    (metadata.pages ?? 1) !== 1 ||
    !metadata.width ||
    !metadata.height ||
    metadata.width < 200 ||
    metadata.height < 200 ||
    expiresAt.getTime() <= Date.now()
  )
    throw new Error("wechat_qr_response_invalid");
  return `data:image/${metadata.format};base64,${base64}`;
}
