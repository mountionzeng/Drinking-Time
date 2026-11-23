import type { ImageAsset } from "../../shared/imageAsset";
import { readBoardFrames, transitionBoardNumbers, type BoardFrame, type ShotKeyframe } from "../../shared/storyKeyframes";
import { jsonRecord } from "../repositories/storyValues";

type Shot = { stableShotId: string; shotNo: number; generationParams?: unknown };
type Slot = { rootId: number; owner: string; sourceShotId?: string; label: string; ids: number[] };

/** Explicit storyboard positions outrank historical generation ownership. A reference alone is never a revision. */
export function storyKeyframes(storyId: number, shots: Shot[], assets: ImageAsset[], messages: unknown): ShotKeyframe[] {
  const available = new Map(assets.filter(i => i.storyId === storyId && i.kind === "story_frame").map(i => [i.id, i]));
  const byImage = new Map<number, Slot>();
  const slots = new Map(shots.map(s => [s.stableShotId, [] as Slot[]]));
  function register(owner: string, frame: BoardFrame, sourceShotId?: string) {
    if (!available.has(frame.imageId) || !slots.has(owner)) return;
    const previous = byImage.get(frame.imageId);
    if (previous) return previous.owner === owner ? previous : undefined;
    const slot: Slot = { rootId: frame.imageId, owner, sourceShotId, label: frame.label, ids: [] };
    slots.get(owner)!.push(slot);
    byImage.set(frame.imageId, slot);
    return slot;
  }
  // A promoted board retains its source IDs even if the original chat is archived.
  for (const shot of shots) {
    let params;
    try { params = JSON.parse(String(shot.generationParams || "{}")); } catch { continue; }
    const frames = params?.keyframeBoard?.frames;
    if (Array.isArray(frames)) for (const f of frames) {
      if (f && Number.isSafeInteger(f.imageId) && typeof f.label === "string") register(shot.stableShotId, f, params.keyframeBoard.sourceShotId);
    }
  }
  // Position-only legacy revisions are safe only with a single explicitly numbered initial board.
  const boards = new Map<string, Set<string>>();
  const latestBoard = new Map<string, (Slot | undefined)[]>();
  for (const raw of Array.isArray(messages) ? messages : []) {
    const m = jsonRecord(raw), quote = jsonRecord(m.selectionQuote), owner = quote.stableShotId;
    if (m.who !== "s" || quote.storyId !== storyId || typeof owner !== "string" || !slots.has(owner) ||
        typeof m.id !== "string" || typeof m.text !== "string" || transitionBoardNumbers(m.text)) continue;
    const frames = readBoardFrames(m.id, m.text);
    if (!frames.length) continue;
    const key = owner + ":" + frames.length;
    const previous = latestBoard.get(key);
    const isRevision = m.text.split("\n")[0].includes("关键帧修订稿");
    if (!isRevision) {
      const signatures = boards.get(key) ?? new Set<string>();
      signatures.add(frames.map(frame => frame.imageId).join(","));
      boards.set(key, signatures);
    }
    const revision = isRevision && boards.get(key)?.size === 1 && previous?.length === frames.length;
    const board = frames.map((frame, index) => {
      const image = available.get(frame.imageId);
      if (!image) return;
      const parent = image.parentImageId ? byImage.get(image.parentImageId) : undefined;
      const slot = byImage.get(frame.imageId) ?? parent ?? (revision ? previous[index] : undefined) ?? register(owner, frame);
      if (slot?.owner === owner) { byImage.set(frame.imageId, slot); return slot; }
    });
    latestBoard.set(key, board);
  }
  // Database image IDs are immutable and new edits point to a prior image.
  for (const image of [...available.values()].sort((a, b) => a.id - b.id)) {
    const owner = image.shotIdentity || (image.libraryShotIds?.length === 1 ? image.libraryShotIds[0] : undefined);
    let slot = byImage.get(image.id);
    if (!slot && image.parentImageId) {
      const parent = byImage.get(image.parentImageId);
      if (parent && (!owner || owner === parent.owner || owner === parent.sourceShotId)) slot = parent;
    }
    if (!slot && owner) slot = register(owner, { imageId: image.id, label: "" });
    if (slot) { byImage.set(image.id, slot); slot.ids.push(image.id); }
  }
  return shots.flatMap(shot => slots.get(shot.stableShotId)!.map((slot, index) => ({
    rootId: slot.rootId, stableShotId: shot.stableShotId, sourceShotId: slot.sourceShotId,
    code: String(shot.shotNo).padStart(2, "0") + String(index + 1).padStart(2, "0"),
    label: slot.label, versions: slot.ids,
    latestImageId: [...slot.ids].reverse().find(id => available.get(id)?.availability !== "missing") ?? null,
  })));
}
