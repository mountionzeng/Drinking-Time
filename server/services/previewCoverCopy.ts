import { createHash, randomBytes, randomUUID } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import sharp from "sharp";
import { ENV } from "../_core/env";
import { getGeneratedImageById } from "../repositories/images";
import { uploadFileTo302 } from "./videoTransition302";
import { readOwnedWechatImage } from "./wechatVideoImage";

type Scope = { storyId: number; userId: number; imageId: number; roundId: string };
const audience = "storyboard-preview-cover-copy";
const sessionKey = randomBytes(32);
const key = () => ENV.cookieSecret ? createHash("sha256").update(audience).update("\0").update(ENV.cookieSecret).digest() : sessionKey;
const subject = (s: Scope) => [s.userId, s.storyId, s.imageId, s.roundId].join("/");

/** Only an explicitly selected, owned private cover can be copied to the provider. */
export async function preparePreviewCoverCopy(scope: Scope) {
  const image = await getGeneratedImageById(scope.imageId);
  if (!image || image.storyId !== scope.storyId || image.userId !== scope.userId)
    throw new Error("封面已更换，请重新查看试图。");
  const original = await readOwnedWechatImage(image.imageUrl, scope.userId);
  if (!original) throw new Error("这张封面原图已经无法读取，请重新关联。");
  const pipeline = sharp(original, { limitInputPixels: 80_000_000 });
  const meta = await pipeline.metadata();
  const side = Math.max(1, Math.min(768, Math.floor(Math.max(meta.width ?? 0, meta.height ?? 0) / 2)));
  const bytes = await pipeline.rotate().resize(side, side, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
  let url: URL;
  try {
    url = new URL(await uploadFileTo302({ fileName: `reference-${randomUUID()}.jpg`, contentType: "image/jpeg", bytes }));
    if (url.protocol !== "https:" || url.port || url.username || url.password ||
      !["file.302.ai", "file.302ai.cn"].includes(url.hostname)) throw new Error();
    if (url.hostname === "file.302.ai" && new URL(ENV.api302BaseUrl).hostname === "api.302ai.cn") url.hostname = "file.302ai.cn";
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!response.ok || !/^image\/jpeg(?:;|$)/i.test(response.headers.get("content-type") ?? "") ||
      !Buffer.from(await response.arrayBuffer()).equals(bytes)) throw new Error();
  } catch {
    throw new Error("302 未能提供可读的封面缩图，请稍后重新准备。本次没有提交生成。");
  }
  // Quotes can travel between workers. Keep the provider URL out of exported story data and UI.
  return new EncryptJWT({ source: image.imageUrl, url: url.href }).setProtectedHeader({ alg: "dir", enc: "A256GCM" })
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
