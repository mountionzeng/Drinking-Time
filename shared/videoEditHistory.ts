/** Editing revisions are independent of immutable finished-product versions. */
export type VideoEditRevision = {
  version: number;
  savedAt: number;
  shots: Record<string, unknown>[];
  timeline: {
    items: unknown;
    overlays?: unknown;
    visualLayerState?: unknown;
    extensions?: Record<string, unknown>;
  };
};
export type VideoEditHistory = {
  schemaVersion: 1;
  revisions: VideoEditRevision[];
};
export const VIDEO_EDIT_HISTORY_LIMIT = 30;

export function readVideoEditHistory(value: unknown): VideoEditRevision[] {
  if (
    !value ||
    typeof value !== "object" ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("revisions" in value) ||
    !Array.isArray(value.revisions)
  )
    return [];
  return value.revisions.filter((revision): revision is VideoEditRevision =>
    Boolean(
      revision &&
        Number.isInteger(revision.version) &&
        Array.isArray(revision.shots) &&
        revision.timeline &&
        "items" in revision.timeline
    )
  );
}
