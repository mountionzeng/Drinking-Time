import type { ImageAsset } from "../../shared/imageAsset";
import { inlineChatParts } from "../../shared/inlineChatImages";
import { jsonRecord } from "../repositories/storyValues";

/** Archive associations for display. Keep generation metadata and timeline ownership intact. */
export function libraryImageShots(storyId: number, body: Record<string, unknown>, shots: readonly { stableShotId: string }[],
  storedBookResults: readonly { chapterId: number | null; moduleId: string | null; candidates: unknown }[] = []) {
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
  function addCandidates(shotId: unknown, candidates: unknown) {
    if (Array.isArray(candidates)) for (const candidate of candidates) add(shotId, jsonRecord(candidate).imageId);
  }
  const completedTasks = (Array.isArray(body.storyboardImageTasks) ? body.storyboardImageTasks : [])
    .map(jsonRecord).filter(task => task.status === "succeeded" && typeof task.requestId === "string");
  for (const task of completedTasks) addCandidates(task.shotIdentity, jsonRecord(task.result).candidates);
  const previewTasks = new Map(completedTasks.map(task => [task.requestId, task]));
  for (const batch of Array.isArray(body.artPreviewBatches) ? body.artPreviewBatches : []) {
    const { id, shots: rows } = jsonRecord(batch);
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const shot = jsonRecord(row);
      addCandidates(shot.stableShotId, shot.candidates);
      const task = previewTasks.get(shot.requestId);
      if (task && typeof id === "string" && task.shotIdentity === `preview:${id}:${shot.stableShotId}`)
        addCandidates(shot.stableShotId, jsonRecord(task.result).candidates);
    }
  }
  // A single book module may explicitly feed several shots. A matching module name
  // in another chapter (or a neighbouring shot number) does not establish a link.
  const moduleShots = new Map<string, Set<string>>();
  for (const row of Array.isArray(body.shots) ? body.shots : []) {
    const shot = jsonRecord(row);
    const shotId = shot.stableShotId ?? shot.shotIdentity ?? shot.shotKey;
    const refs = jsonRecord(shot.publishingVideo).sourceModuleIds;
    if (typeof shotId !== "string" || !live.has(shotId) || !Array.isArray(refs)) continue;
    for (const ref of refs) {
      if (typeof ref !== "string") continue;
      const owners = moduleShots.get(ref) ?? new Set<string>();
      owners.add(shotId);
      moduleShots.set(ref, owners);
    }
  }
  const legacyResults = (Array.isArray(body.bookModuleImageTasks) ? body.bookModuleImageTasks : [])
    .map(jsonRecord).filter(task => task.status === "succeeded");
  for (const task of [...legacyResults, ...storedBookResults]) {
    if (typeof task.chapterId !== "number" || typeof task.moduleId !== "string") continue;
    for (const shotId of moduleShots.get(`${task.chapterId}:${task.moduleId}`) ?? [])
      addCandidates(shotId, task.candidates);
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
