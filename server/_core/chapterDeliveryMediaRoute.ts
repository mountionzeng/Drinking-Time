import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Router, raw } from "express";
import { completeChapterAssetUpload, findChapterAssetUpload, getChapterDelivery, listChapterDeliveryAssets } from "../repositories/chapterDeliveries";
import { storageGet, storagePut } from "../storage";
import { ENV } from "./env";

const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const extension: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Image bytes use a short-lived capability and never travel through the signed JSON bridge. */
export function chapterDeliveryMediaRoutes() {
  const router = Router();
  router.get("/download/:deliveryId/:assetId", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (process.env.CHAPTER_PACKAGE_ENABLED !== "true" || process.env.CHAPTER_DELIVERY_ENABLED !== "true")
        return res.status(404).json({ error: "not_found" });
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
      const { url } = await storageGet(asset.storageKey);
      const source = new URL(url);
      if (source.protocol !== "https:" || source.username || source.password)
        return res.status(503).json({ error: "download_unavailable" });
      const response = await fetch(source, { redirect: "error", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return res.status(503).json({ error: "download_unavailable" });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== asset.bytes || hash(bytes) !== asset.sha256)
        return res.status(503).json({ error: "download_unavailable" });
      res.setHeader("Content-Type", asset.mime);
      res.setHeader("Content-Length", String(bytes.length));
      return res.status(200).send(bytes);
    } catch {
      return res.status(503).json({ error: "download_unavailable" });
    }
  });
  router.put("/:packageId/:assetId", raw({ type: "image/*", limit: "2mb" }), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (process.env.CHAPTER_PACKAGE_ENABLED !== "true" || process.env.CHAPTER_DELIVERY_ENABLED !== "true")
        return res.status(404).json({ error: "not_found" });
      const token = req.header("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      if (!token || !Buffer.isBuffer(req.body)) return res.status(400).json({ error: "invalid_upload" });
      const asset = await findChapterAssetUpload(createHash("sha256").update(token).digest("hex"));
      if (!asset || asset.packageId !== req.params.packageId || asset.assetId !== req.params.assetId || !asset.uploadExpiresAt || asset.uploadExpiresAt <= new Date())
        return res.status(404).json({ error: "invalid_upload" });
      const mime = req.header("content-type")?.split(";")[0]?.toLowerCase();
      if (mime !== asset.mime || req.body.length !== asset.bytes || hash(req.body) !== asset.sha256)
        return res.status(400).json({ error: "asset_mismatch" });
      const key = `chapter-deliveries/${asset.sha256}.${extension[asset.mime] ?? "bin"}`;
      await storagePut(key, req.body, asset.mime);
      const outcome = await completeChapterAssetUpload({
        packageId: asset.packageId, assetId: asset.assetId,
        tokenHash: createHash("sha256").update(token).digest("hex"), storageKey: key, uploadedAt: new Date(),
      });
      if (outcome === "invalid") return res.status(409).json({ error: "upload_expired" });
      return res.json({ ok: true, repeated: outcome === "repeated" });
    } catch {
      return res.status(503).json({ error: "upload_unavailable" });
    }
  });
  return router;
}
