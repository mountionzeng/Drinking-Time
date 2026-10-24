import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Router, raw, type Request, type Response } from "express";
import {
  completeChapterAssetUpload,
  findChapterAssetUpload,
  getChapterDelivery,
  listChapterDeliveryAssets,
} from "../repositories/chapterDeliveries";
import { storageGet, storagePut } from "../storage";
import { ENV } from "./env";
import { createRequestOriginMiddleware } from "./requestOrigin";

const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const extension: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const chapterDeliveryUploadBodyParser = raw({ type: "image/*", limit: "2mb" });

async function readResponseBytes(response: globalThis.Response, maxBytes: number) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("media_body_unavailable");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("media_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
}

function enabled() {
  return process.env.CHAPTER_PACKAGE_ENABLED === "true" && process.env.CHAPTER_DELIVERY_ENABLED === "true";
}

/** Image bytes use a short-lived capability and never travel through the signed JSON bridge. */
export async function handleChapterDeliveryDownload(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!enabled()) return res.status(404).json({ error: "not_found" });
    const deliveryId = String(req.params.deliveryId), assetId = String(req.params.assetId);
    const expiresAt = Number(req.query.e), token = String(req.query.token ?? "");
    const now = Date.now();
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 5 * 60 * 1000 || !/^[A-Za-z0-9_-]{43}$/.test(token))
      return res.status(404).json({ error: "not_found" });
    const delivery = await getChapterDelivery(deliveryId);
    if (!delivery?.readyAt || delivery.expiresAt <= new Date() || !delivery.recipientUserId)
      return res.status(404).json({ error: "not_found" });
    const expected = createHmac("sha256", ENV.cookieSecret)
      .update(`chapter-delivery-download:v1:${deliveryId}:${delivery.recipientUserId}:${assetId}:${expiresAt}`)
      .digest();
    const received = Buffer.from(token, "base64url");
    if (received.length !== expected.length || !timingSafeEqual(received, expected))
      return res.status(404).json({ error: "not_found" });
    const asset = (await listChapterDeliveryAssets(delivery.packageId)).find(item => item.assetId === assetId);
    if (!asset?.storageKey) return res.status(404).json({ error: "not_found" });
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > MAX_IMAGE_BYTES)
      return res.status(503).json({ error: "download_unavailable" });
    const { url } = await storageGet(asset.storageKey);
    const source = new URL(url);
    if (source.protocol !== "https:" || source.username || source.password)
      return res.status(503).json({ error: "download_unavailable" });
    const response = await fetch(source, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return res.status(503).json({ error: "download_unavailable" });
    const bytes = await readResponseBytes(response, asset.bytes);
    if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256)
      return res.status(503).json({ error: "download_unavailable" });
    res.setHeader("Content-Type", asset.mime);
    res.setHeader("Content-Length", String(bytes.length));
    return res.status(200).send(bytes);
  } catch {
    return res.status(503).json({ error: "download_unavailable" });
  }
}

export async function handleChapterDeliveryUpload(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!enabled()) return res.status(404).json({ error: "not_found" });
    const token = req.header("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token || !Buffer.isBuffer(req.body)) return res.status(400).json({ error: "invalid_upload" });
    const asset = await findChapterAssetUpload(createHash("sha256").update(token).digest("hex"));
    if (!asset || asset.packageId !== req.params.packageId || asset.assetId !== req.params.assetId || !asset.uploadExpiresAt || asset.uploadExpiresAt <= new Date())
      return res.status(404).json({ error: "invalid_upload" });
    const mime = req.header("content-type")?.split(";")[0]?.toLowerCase();
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > MAX_IMAGE_BYTES || mime !== asset.mime || req.body.length !== asset.bytes || hash(req.body) !== asset.sha256)
      return res.status(400).json({ error: "asset_mismatch" });
    const key = `chapter-deliveries/${asset.sha256}.${extension[asset.mime] ?? "bin"}`;
    await storagePut(key, req.body, asset.mime);
    const outcome = await completeChapterAssetUpload({
      packageId: asset.packageId,
      assetId: asset.assetId,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      storageKey: key,
      uploadedAt: new Date(),
    });
    if (outcome === "invalid") return res.status(409).json({ error: "upload_expired" });
    return res.json({ ok: true, repeated: outcome === "repeated" });
  } catch {
    return res.status(503).json({ error: "upload_unavailable" });
  }
}

export function chapterDeliveryMediaRoutes() {
  const router = Router();
  router.use(createRequestOriginMiddleware({
    isProduction: process.env.NODE_ENV === "production",
    appOrigin: process.env.APP_ORIGIN ?? "",
  }));
  router.get("/download/:deliveryId/:assetId", handleChapterDeliveryDownload);
  router.put("/:packageId/:assetId", chapterDeliveryUploadBodyParser, handleChapterDeliveryUpload);
  return router;
}
