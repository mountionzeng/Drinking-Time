import { createHash, randomBytes, randomUUID } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import sharp from "sharp";
import { ENV } from "../_core/env";
import { getGeneratedImageById } from "../repositories/images";
import { uploadFileTo302 } from "./videoTransition302";
import { readOwnedImageBytes } from "./ownedImageBytes";
import { ossConfigFromEnv, publicReferenceKey, putPublicReference } from "./publicReferenceHost";
import { withDeadline } from "./providerDeadline";
import { isProviderPublicImageUrl } from "../../shared/providerImageUrl";

type Scope = { storyId: number; userId: number; imageId: number; roundId: string; allowPublicHosting?: boolean };
const audience = "storyboard-preview-cover-copy";
const sessionKey = randomBytes(32);
const key = () => ENV.cookieSecret ? createHash("sha256").update(audience).update("\0").update(ENV.cookieSecret).digest() : sessionKey;
const subject = (s: Scope) => [s.userId, s.storyId, s.imageId, s.roundId].join("/");

/** Only an explicitly selected, owned private cover can be copied to the provider. */
export async function preparePreviewCoverCopy(scope: Scope, expectedSource?: string) {
  const image = await getGeneratedImageById(scope.imageId);
  if (!image || image.storyId !== scope.storyId || image.userId !== scope.userId)
    throw new Error("封面已更换，请重新查看试图。");
  if (expectedSource !== undefined && image.imageUrl !== expectedSource) throw new Error("参考图已更换，请重新定位。本次未提交生成。");
  const original = await readOwnedImageBytes(image.imageUrl, scope.userId);
  if (!original) throw new Error("这张参考原图已经无法读取，请重新关联。");
  const pipeline = sharp(original.bytes, { limitInputPixels: 80_000_000 });
  const meta = await pipeline.metadata();
  const side = Math.max(1, Math.min(768, Math.floor(Math.max(meta.width ?? 0, meta.height ?? 0) / 2)));
  const bytes = await pipeline.rotate().resize(side, side, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
  const fileName = `reference-${randomUUID()}.jpg`;
  const verify = async (url: URL) => {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`http-${response.status}`);
    if (!/^image\/jpeg(?:;|$)/i.test(response.headers.get("content-type") ?? "") ||
      !Buffer.from(await response.arrayBuffer()).equals(bytes)) throw new Error("invalid-copy");
    return url;
  };
  const verifyWithinDeadline = (url: URL) => withDeadline(verify(url), 20_000, "verify-timeout");
  const summary = (error: unknown) => error instanceof Error && /^(?:http-\d{3}|invalid-copy|(?:upload|verify)-timeout)$/.test(error.message)
    ? error.message : "transport-or-address";
  const config = scope.allowPublicHosting ? ossConfigFromEnv() : undefined;
  let verified: URL | undefined;
  if (config) {
    try {
      const hosted = await withDeadline(putPublicReference({ key: publicReferenceKey(fileName, bytes), bytes,
        contentType: "image/jpeg", config }), 30_000, "upload-timeout");
      if (!hosted || !isProviderPublicImageUrl(hosted)) throw new Error("invalid-copy");
      verified = await verifyWithinDeadline(new URL(hosted));
    } catch (error) {
      console.warn("[reference-thumbnail] OSS", summary(error));
    }
  }
  if (!verified) try {
    const url = new URL(await withDeadline(uploadFileTo302({ fileName, contentType: "image/jpeg", bytes }), 30_000, "upload-timeout"));
    if (url.protocol !== "https:" || url.port || url.username || url.password ||
      !["file.302.ai", "file.302ai.cn"].includes(url.hostname)) throw new Error();
    if (url.hostname === "file.302.ai" && new URL(ENV.api302BaseUrl).hostname === "api.302ai.cn") url.hostname = "file.302ai.cn";
    verified = await verifyWithinDeadline(url);
  } catch (error) {
    console.warn("[reference-thumbnail] 302", summary(error));
    throw new Error("302 未能提供可读的参考缩图，请稍后重新准备。本次没有提交生成。");
  }
  // Quotes can travel between workers. Keep the provider URL out of exported story data and UI.
  return new EncryptJWT({ source: image.imageUrl, url: verified.href }).setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setAudience(audience).setSubject(subject(scope)).setExpirationTime("1h").encrypt(key());
}

export async function openPreviewCoverCopy(receipt: string, scope: Scope) {
  try {
    const { payload } = await jwtDecrypt(receipt, key(), { audience, subject: subject(scope),
      keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] });
    if (typeof payload.source !== "string" || typeof payload.url !== "string") throw new Error();
    return { source: payload.source, url: payload.url };
  } catch {
    throw new Error("这轮封面缩图凭据已失效，请重新查看报价。");
  }
}
