import { normalizeSubtitleState } from "./timelineSubtitleModel";

/** Expose only stable origin, never provider/billing provenance or inferred shot numbers. */
export function audioWarehouseShotId(
  provenance: unknown,
  subtitleTracks: unknown
): string | null {
  if (!provenance || typeof provenance !== "object") return null;
  const p = provenance as Record<string, unknown>;
  if (p.bookTarget || p.kind === "book-video-audio") return null;
  if (typeof p.stableShotId === "string" && p.stableShotId.trim())
    return /^book(?::|$)/.test(p.stableShotId) ? null : p.stableShotId;
  if (typeof p.subtitleCueId !== "string") return null;
  const cue = normalizeSubtitleState(subtitleTracks)
    .tracks.flatMap(t => t.cues)
    .find(c => c.id === p.subtitleCueId);
  return cue?.provenance.kind === "shot-dialogue"
    ? cue.provenance.stableShotId
    : null;
}
