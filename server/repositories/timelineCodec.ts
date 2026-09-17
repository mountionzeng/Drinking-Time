/** Persistence operations for timelineCodec. Local and MySQL behavior share this boundary. */
import {
  decodeStoredStoryTimeline,
  encodeStoredStoryTimeline,
  mergeStoredStoryTimelineExtensions,
} from "../persistence/storyTimelinePersistence";
import { StoryTimeline } from "../../drizzle/schema";

export type StoryTimelinePayload = {
  items: unknown;
  overlays?: unknown;
  visualLayerState?: unknown;
  /**
   * Non-visual media slices (subtitles in U3, audio in U9). A visual writer
   * never sets this and must never drop it; it is preserved from the stored
   * document by the canonical codec on every save.
   */
  extensions?: Record<string, unknown>;
};

// Thin wrappers over the one canonical codec in
// server/persistence/storyTimelinePersistence.ts. Do not reimplement envelope
// decode/encode here — the architecture guard forbids a second codec.
export function decodeStoryTimelinePayload(
  value: unknown
): StoryTimelinePayload {
  return decodeStoredStoryTimeline(value);
}

export function encodeStoryTimelinePayload(
  payload: StoryTimelinePayload
): unknown {
  return encodeStoredStoryTimeline(payload);
}

export function replaceStoryTimelineItemsPreservingOverlays(
  currentValue: unknown,
  nextItems: unknown
): unknown {
  const current = decodeStoryTimelinePayload(currentValue);
  const next = decodeStoryTimelinePayload(nextItems);
  return encodeStoryTimelinePayload({
    items: next.items,
    overlays: current.overlays ?? next.overlays,
    visualLayerState: current.visualLayerState ?? next.visualLayerState,
    // The replacement `nextItems` is a bare visual document; extension slices
    // only ever live on the stored row, so carry them straight through.
    extensions: mergeStoredStoryTimelineExtensions(
      currentValue,
      next.extensions
    ),
  });
}

export function storyTimelineView(row: StoryTimeline): StoryTimeline & {
  overlays?: unknown;
  visualLayerState?: unknown;
  extensions?: Record<string, unknown>;
} {
  const payload = decodeStoryTimelinePayload(row.items);
  return {
    ...row,
    items: payload.items,
    ...(payload.overlays === undefined ? {} : { overlays: payload.overlays }),
    ...(payload.visualLayerState === undefined
      ? {}
      : { visualLayerState: payload.visualLayerState }),
    // Non-visual slices ride along in a namespaced bag; nothing in U1 reads
    // them, but the view must not be where they get dropped.
    ...(payload.extensions === undefined
      ? {}
      : { extensions: payload.extensions }),
  };
}
