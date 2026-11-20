import type { ImageAsset } from "../../shared/imageAsset";
import { inlineChatParts } from "../../shared/inlineChatImages";
import { jsonRecord } from "../repositories/storyValues";

/** Archive associations for display. Keep generation metadata and timeline ownership intact. */
export function libraryImageShots(storyId: number, body: Record<string, unknown>, shots: readonly { stableShotId: string }[]) {
  const live = new Set(shots.map(shot => shot.stableShotId));
  const byImage = new Map<number, Set<string>>();
  function add(shotId: unknown, imageId: unknown) {
    if (typeof shotId !== "string" || !live.has(shotId) ||
        typeof imageId !== "number" || !Number.isSafeInteger(imageId) || imageId < 1) return;
    const ids = byImage.get(imageId) ?? new Set<string>();
    ids.add(shotId);
    byImage.set(imageId, ids);
  }
  for (const row of Array.isArray(body.shotConversationMedia) ? body.shotConversationMedia : []) {
    const record = jsonRecord(row);
    if (Array.isArray(record.imageIds)) for (const id of record.imageIds) add(record.stableShotId, id);
  }
  for (const batch of Array.isArray(body.artPreviewBatches) ? body.artPreviewBatches : []) {
    const rows = jsonRecord(batch).shots;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const shot = jsonRecord(row);
      if (Array.isArray(shot.candidates)) for (const candidate of shot.candidates) add(shot.stableShotId, jsonRecord(candidate).imageId);
    }
  }
  for (const row of Array.isArray(body.messages) ? body.messages : []) {
    const message = jsonRecord(row);
    if (message.who !== "s") continue;
    const revision = jsonRecord(message.imageRevision);
    if (revision.storyId === storyId) add(revision.stableShotId, revision.imageId);
    const quote = jsonRecord(message.selectionQuote);
    if (quote.storyId !== storyId || typeof message.id !== "string" ||
        !message.id.startsWith("saved-photos:") || typeof message.text !== "string") continue;
    try {
      for (const part of inlineChatParts(message.text)) if (part.imageId) add(quote.stableShotId, part.imageId);
    } catch { /* Malformed historical messages cannot establish provenance. */ }
  }
  return (image: ImageAsset): ImageAsset => {
    if (image.storyId !== storyId) return image;
    const ids = new Set(byImage.get(image.id));
    if (image.shotIdentity && live.has(image.shotIdentity)) ids.add(image.shotIdentity);
    return ids.size ? { ...image, libraryShotIds: [...ids] } : image;
  };
}
