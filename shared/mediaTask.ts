/** Background media generation (video / music / narration / tts) on the image_generation_tasks table. */
export const MEDIA_KINDS = ["image", "video", "music", "narration", "tts"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export type SyncMediaKind = "music" | "narration" | "tts";
export const isSyncMediaKind = (k: string): k is SyncMediaKind => k === "music" || k === "narration" || k === "tts";

/** Sync upstream (no task id): after this long without a confirmed result the hold is auto-released. */
export const SYNC_MEDIA_AUTO_RELEASE_MS = 30 * 60_000;
/** Video with a task id: poll this long, then keep the hold and hand over to reconciliation. */
export const VIDEO_TASK_POLL_WINDOW_MS = 30 * 60_000;
export const videoTaskRef = (takeId: number) => `video_take:${takeId}`;
export function parseVideoTaskRef(ref: string | null | undefined): number | null {
  const m = /^video_take:(\d+)$/.exec(ref ?? "");
  return m ? Number(m[1]) : null;
}

export type StaleSyncMediaEvidence = {
  /** A ready asset exists for this operation (stored successfully). */
  assetStored: boolean;
  /** Provider returned an audio URL that we recorded but did not finish storing. */
  providerOutputRecorded: boolean;
  /** Ledger operation already terminal (settled / released / exception). */
  ledgerFinal: boolean;
};
export type StaleSyncMediaDecision =
  | { action: "succeed"; charge: boolean } // stored: never refund
  | { action: "manual" } // provider output proven, not stored: keep hold for reconciliation
  | { action: "release" } // cannot prove output: refund the hold
  | { action: "close" }; // ledger already final: just close the task

/** Refund only when it cannot be proven that output was produced. */
export function decideStaleSyncMedia(e: StaleSyncMediaEvidence): StaleSyncMediaDecision {
  if (e.assetStored) return { action: "succeed", charge: !e.ledgerFinal };
  if (e.ledgerFinal) return { action: "close" };
  if (e.providerOutputRecorded) return { action: "manual" };
  return { action: "release" };
}
