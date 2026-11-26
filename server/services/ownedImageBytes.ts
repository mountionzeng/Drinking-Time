import { readFile } from "node:fs/promises";
import path from "node:path";
import { localImagePathForUrl } from "./imageAssets";
import { ENV } from "../_core/env";
import { isWechatImportImage, readOwnedWechatImage } from "./wechatVideoImage";

export type OwnedImageBytes = { bytes: Buffer; fileName: string; contentType: string };

function mimeAndName(fileName: string): { fileName: string; contentType: string } {
  const base = path.basename(fileName) || "style.png";
  const ext = path.extname(base).toLowerCase();
  const contentType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
    : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/png";
  return { fileName: base, contentType };
}

function parseDataImage(url: string): OwnedImageBytes | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(url);
  if (!match) return null;
  const contentType = match[1] || "image/png";
  const payload = match[3] || "";
  const bytes = Buffer.from(payload, match[2] ? "base64" : "utf8");
  if (!bytes.length) return null;
  const ext = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg"
    : contentType.includes("webp") ? "webp" : contentType.includes("gif") ? "gif" : "png";
  return { bytes, fileName: `style.${ext}`, contentType };
}

/** Read bytes the current user is allowed to use as a style or cover reference. */
export async function readOwnedImageBytes(url: string, userId: number): Promise<OwnedImageBytes | null> {
  const data = parseDataImage(url);
  if (data) return data;
  if (!url.startsWith("/")) {
    try {
      const absolute = new URL(url);
      if (absolute.origin !== new URL(ENV.appOrigin).origin) return null;
      url = absolute.pathname;
    } catch { return null; }
  }
  if (isWechatImportImage(url)) {
    const bytes = await readOwnedWechatImage(url, userId);
    if (!bytes) return null;
    const fileName = url.split("/").pop() || "wechat.jpg";
    return { bytes, ...mimeAndName(fileName) };
  }
  const localPath = localImagePathForUrl(url);
  if (!localPath) return null;
  try {
    const bytes = await readFile(localPath);
    return bytes.length ? { bytes, ...mimeAndName(localPath) } : null;
  } catch {
    return null;
  }
}
