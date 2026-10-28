import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import { ENV } from "./_core/env";

const KEY = /^(?:chapters\/[1-9]\d*|chapter-deliveries)\/[a-f0-9]{64}\.(?:jpg|png|webp)$/;
export const isChapterMediaKey = (key: string) => KEY.test(key);
const root = () => process.env.CHAPTER_MEDIA_DIR || path.join(process.cwd(), ".webdev", "chapter-media");
const signature = (key: string, expiry: number) => {
  if (!ENV.cookieSecret) throw new Error("Chapter media signing key missing");
  return createHmac("sha256", ENV.cookieSecret).update(`chapter-media:v1:${key}:${expiry}`).digest("base64url");
};
export async function readChapterMedia(key: string): Promise<Buffer | null> {
  if (!KEY.test(key)) return null;
  try { return await fs.readFile(path.join(root(), key)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function putChapterMedia(key: string, data: Buffer | Uint8Array | string) {
  if (!KEY.test(key)) throw new Error("Invalid chapter media key");
  const bytes = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
  if (bytes.length > 2 * 1024 * 1024) throw new Error("Chapter image exceeds limit");
  const file = path.join(root(), key);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  // Content-addressed immutable files: publish atomically so retries/readers never see partial bytes.
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try { await fs.writeFile(temp, bytes, { mode: 0o600 }); await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }); }
}
export function chapterMediaUrl(key: string) {
  if (!KEY.test(key)) throw new Error("Invalid chapter media key");
  const expiry = Date.now() + 60 * 60 * 1000;
  return `/api/chapter-media?key=${encodeURIComponent(key)}&e=${expiry}&token=${signature(key, expiry)}`;
}
export async function handleChapterMedia(req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    const key = String(req.query.key || ""), expiry = Number(req.query.e), token = String(req.query.token || "");
    if (!KEY.test(key) || !Number.isSafeInteger(expiry) || expiry <= Date.now() || expiry > Date.now() + 60 * 60 * 1000 || !/^[A-Za-z0-9_-]{43}$/.test(token)) return res.sendStatus(404);
    const a = Buffer.from(token), b = Buffer.from(signature(key, expiry));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return res.sendStatus(404);
    const bytes = await readChapterMedia(key);
    if (!bytes) return res.sendStatus(404);
    res.type(key.endsWith(".jpg") ? "image/jpeg" : key.endsWith(".png") ? "image/png" : "image/webp");
    return res.send(bytes);
  } catch { return res.sendStatus(503); }
}
