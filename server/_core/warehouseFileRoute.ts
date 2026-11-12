import type { Request, Response } from "express";
import { resolveMediaRouteUserId } from "./mediaRouteAuth";
import { readWarehouseOriginal } from "../services/warehouseFiles";
export async function downloadWarehouseFile(req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    const userId = await resolveMediaRouteUserId(req);
    if (!userId) {
      res.sendStatus(401);
      return;
    }
    const storyId = Number(req.params.storyId),
      fileId = Number(req.params.fileId);
    if (
      !Number.isSafeInteger(storyId) ||
      storyId <= 0 ||
      !Number.isSafeInteger(fileId) ||
      fileId <= 0
    ) {
      res.sendStatus(404);
      return;
    }
    const { file, bytes } = await readWarehouseOriginal({
      storyId,
      userId,
      fileId,
    });
    res.type("application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`
    );
    res.send(bytes);
  } catch {
    res.sendStatus(404);
  }
}
