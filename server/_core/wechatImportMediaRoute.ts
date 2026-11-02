import type { Request, Response } from "express";
import { resolveMediaRouteUserId } from "./mediaRouteAuth";
import { ownsWechatImportImage } from "../repositories/wechatBookImport";
import { readChapterMedia } from "../chapterMediaStore";

/** Permanent URL, authenticated on every read; no expiring URL in saved prose. */
export async function handleWechatImportMedia(req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    const userId = await resolveMediaRouteUserId(req);
    if (!userId) return res.sendStatus(401);
    const file = String(req.params.file);
    if (!/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(file))
      return res.sendStatus(404);
    const key = `chapters/${userId}/${file}`;
    if (!(await ownsWechatImportImage(userId, key))) return res.sendStatus(404);
    const bytes = await readChapterMedia(key);
    if (!bytes) return res.sendStatus(404);
    return res
      .type(
        file.endsWith(".jpg")
          ? "image/jpeg"
          : file.endsWith(".png")
            ? "image/png"
            : "image/webp"
      )
      .send(bytes);
  } catch {
    return res.sendStatus(503);
  }
}
