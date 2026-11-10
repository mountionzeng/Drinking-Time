import type { Request, Response } from "express";
import { normalizeStoryArtDirection } from "../../shared/artDirection";
import { artSystemSkillMarkdown } from "../../shared/artSystem";
import { ownedCreationStory } from "../repositories/textSourceLineage";
import { resolveMediaRouteUserId } from "./mediaRouteAuth";

/** A real attachment works in embedded browsers as well as desktop browsers. */
export async function artSystemSkillDownload(req: Request, res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const storyId = Number(req.params.storyId);
  const version = Number(req.params.version);
  if (!Number.isSafeInteger(storyId) || storyId <= 0 || !Number.isSafeInteger(version) || version <= 0) { res.sendStatus(400); return; }
  try {
    const userId = await resolveMediaRouteUserId(req);
    if (!userId) { res.sendStatus(401); return; }
    const { body } = await ownedCreationStory({ storyId, userId });
    const direction = normalizeStoryArtDirection(body.artDirection);
    const recipe = [direction.recipe, ...direction.recipeVersions].find(item => item?.version === version && item.system);
    if (!recipe) { res.sendStatus(404); return; }
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="art-system-v${version}-SKILL.md"`);
    res.send(artSystemSkillMarkdown(recipe));
  } catch { res.sendStatus(404); }
}
