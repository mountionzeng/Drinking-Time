import { createHash } from "node:crypto";
import { listChapters } from "../repositories/chapters";
import { getStoryImageAssets } from "./imageAssets";
import { readBookImage } from "../../shared/bookImageBlock";
import {
  imagePackParagraphs,
  type IllustrationPlacement,
} from "../../shared/articleIllustrations";
export async function readBookVideoSource(input: {
  storyId: number;
  userId: number;
}) {
  const chapters = await listChapters(input.storyId, input.userId);
  if (!chapters.length) return null;
  const assets = await getStoryImageAssets(input.storyId, input.userId);
  const lines: string[] = [];
  const pending: Array<{ assetId: number; line: number }> = [];
  const seen = new Set<number>();
  let missingImages = 0;
  for (const chapter of chapters)
    for (const line of chapter.blocks.body.split("\n")) {
      const image = readBookImage(line.trim());
      if (!image) {
        lines.push(line);
        continue;
      }
      const asset = assets.find(
        a =>
          a.imageUrl === image.url &&
          a.availability !== "missing" &&
          a.status !== "rejected"
      );
      if (!asset) {
        missingImages++;
        continue;
      }
      if (!seen.has(asset.id)) {
        pending.push({ assetId: asset.id, line: lines.length });
        seen.add(asset.id);
      }
    }
  const body = lines.join("\n").trim();
  const paragraphs = imagePackParagraphs(body);
  const illustrations: IllustrationPlacement[] = pending.map(p => {
    const before = lines.slice(0, p.line).join("\n").trim();
    const previous = imagePackParagraphs(before).at(-1);
    // Locate by occurrence in the whole manuscript so duplicate paragraphs are stable.
    const count = imagePackParagraphs(before).length;
    return {
      assetId: p.assetId,
      after: previous ? (paragraphs[count - 1]?.anchor ?? null) : null,
    };
  });
  return {
    layout: { body, illustrations },
    missingImages,
    sourceHash: createHash("sha256")
      .update(
        JSON.stringify(
          chapters.map(c => ({
            id: c.id,
            title: c.title,
            body: c.blocks.body,
            position: c.position,
          }))
        )
      )
      .digest("hex"),
  };
}
