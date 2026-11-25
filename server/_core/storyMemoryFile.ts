import type { Request, Response } from "express";
import { getStoryById } from "../repositories/stories";
import { readStoryMemory } from "../repositories/storyMemoryDocument";
import { resolveMediaRouteUserId } from "./mediaRouteAuth";

export async function storyMemoryFile(req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const userId = await resolveMediaRouteUserId(req);
  if (!userId) return void res.sendStatus(401);
  const id = Number(req.params.storyId);
  if (!Number.isSafeInteger(id) || id <= 0) return void res.sendStatus(404);
  const story = await getStoryById(id, userId);
  if (!story) return void res.sendStatus(404);
  const markdown = await readStoryMemory(story);
  if (req.query?.view === "1") {
    res.setHeader("Content-Disposition", 'inline; filename="MEMORY.md"');
    res.type("text/plain").send(markdown);
    return;
  }
  res.setHeader("Content-Disposition", 'attachment; filename="MEMORY.md"');
  res.type("text/markdown").send(markdown);
}
