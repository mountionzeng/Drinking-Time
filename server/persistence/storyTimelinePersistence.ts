/**
 * The single canonical codec for the persisted Story Timeline envelope.
 *
 * Historically `server/db.ts` decoded the stored `storyTimelines.items` column
 * by hand-picking three known keys (`items`, `overlays`, `visualLayerState`)
 * and dropping everything else. The moment a non-visual slice (subtitles in U3,
 * audio in U9) is added to the top level of that JSON, any visual-only writer
 * or undo would silently erase it on the next save.
 *
 * This module owns decode/encode/merge so there is exactly one place that
 * understands the envelope shape. It is intentionally pure — it never imports
 * `../db` — so it stays off the direct-db-importer architecture baseline and
 * can be unit-tested in isolation. `server/db.ts` keeps only thin wiring that
 * calls these functions.
 *
 * Envelope contract:
 * - Legacy bare `items[]` (an array, or any non-object) decodes to
 *   `{ items: <value> }` with no extension slices.
 * - Object form `{ items, overlays?, visualLayerState?, ...extensionSlices }`
 *   decodes with every key that is not `items`/`overlays`/`visualLayerState`
 *   collected into `extensions`.
 * - `encode` emits the bare `items` value only when there is nothing else to
 *   store (no overlays, no visualLayerState, no extension slices), preserving
 *   the legacy on-disk shape for untouched visual timelines.
 * - Extension slices merge per key on write: a caller that provides
 *   `{ subtitleTracks }` replaces only that slice and inherits every other
 *   slice from the stored document.
 */

const KNOWN_ENVELOPE_KEYS = new Set(["items", "overlays", "visualLayerState"]);

export type StoredStoryTimelinePayload = {
  items: unknown;
  overlays?: unknown;
  visualLayerState?: unknown;
  /** Every top-level key that is not a known visual field. Omitted when empty. */
  extensions?: Record<string, unknown>;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Decode a stored `storyTimelines.items` value into its envelope parts. */
export function decodeStoredStoryTimeline(
  value: unknown
): StoredStoryTimelinePayload {
  if (!isPlainRecord(value) || !("items" in value)) {
    return { items: value };
  }
  const record = value;
  const extensions: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (!KNOWN_ENVELOPE_KEYS.has(key)) extensions[key] = record[key];
  }
  return {
    items: record.items,
    overlays: record.overlays,
    visualLayerState: record.visualLayerState,
    ...(Object.keys(extensions).length > 0 ? { extensions } : {}),
  };
}

/** Encode an envelope back to the value stored in `storyTimelines.items`. */
export function encodeStoredStoryTimeline(
  payload: StoredStoryTimelinePayload
): unknown {
  const extensionEntries = payload.extensions
    ? Object.entries(payload.extensions).filter(
        ([, sliceValue]) => sliceValue !== undefined
      )
    : [];
  if (
    payload.overlays === undefined &&
    payload.visualLayerState === undefined &&
    extensionEntries.length === 0
  ) {
    return payload.items;
  }
  return {
    items: payload.items,
    ...(payload.overlays === undefined ? {} : { overlays: payload.overlays }),
    ...(payload.visualLayerState === undefined
      ? {}
      : { visualLayerState: payload.visualLayerState }),
    ...Object.fromEntries(extensionEntries),
  };
}

/**
 * Field-level merge of extension slices for a write.
 *
 * Starts from the slices already stored in `currentValue` and overrides only
 * the keys present in `nextExtensions`. A `next` slice explicitly set to
 * `undefined` clears that slice; an absent key inherits the stored slice.
 * Returns `undefined` when the merged result has no slices, so `encode` keeps
 * the legacy bare shape.
 */
export function mergeStoredStoryTimelineExtensions(
  currentValue: unknown,
  nextExtensions?: Record<string, unknown>
): Record<string, unknown> | undefined {
  const current = decodeStoredStoryTimeline(currentValue).extensions ?? {};
  const merged: Record<string, unknown> = { ...current };
  if (nextExtensions) {
    for (const [key, sliceValue] of Object.entries(nextExtensions)) {
      if (sliceValue === undefined) delete merged[key];
      else merged[key] = sliceValue;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Convenience for the common writer shape: replace the visual fields while
 * carrying every stored extension slice through untouched (optionally applying
 * `nextExtensions` on top). Returns the encoded value ready for storage.
 */
export function encodeStoryTimelinePreservingExtensions(input: {
  currentValue: unknown;
  items: unknown;
  overlays?: unknown;
  visualLayerState?: unknown;
  nextExtensions?: Record<string, unknown>;
}): unknown {
  return encodeStoredStoryTimeline({
    items: input.items,
    ...(input.overlays === undefined ? {} : { overlays: input.overlays }),
    ...(input.visualLayerState === undefined
      ? {}
      : { visualLayerState: input.visualLayerState }),
    ...(() => {
      const extensions = mergeStoredStoryTimelineExtensions(
        input.currentValue,
        input.nextExtensions
      );
      return extensions === undefined ? {} : { extensions };
    })(),
  });
}
