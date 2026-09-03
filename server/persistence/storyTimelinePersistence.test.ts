import { describe, expect, it } from "vitest";
import {
  decodeStoredStoryTimeline,
  encodeStoredStoryTimeline,
  encodeStoryTimelinePreservingExtensions,
  mergeStoredStoryTimelineExtensions,
} from "./storyTimelinePersistence";

const SUBTITLE_SENTINEL = [
  { id: "sub-1", startFrame: 0, durationFrames: 45, text: "你好" },
];
const AUDIO_SENTINEL = [
  { kind: "music", clips: [{ id: "clip-1", assetId: 7 }] },
];

describe("story timeline persistence codec", () => {
  describe("legacy shapes decode safely", () => {
    it("reads a bare items array with no extension slices", () => {
      const items = [{ stableShotId: "shot-a", included: true, position: 0 }];
      expect(decodeStoredStoryTimeline(items)).toEqual({ items });
    });

    it("reads the three-field envelope and leaves absent fields undefined", () => {
      const stored = {
        items: [{ stableShotId: "shot-a" }],
        overlays: [{ id: "overlay-a" }],
      };
      const decoded = decodeStoredStoryTimeline(stored);
      expect(decoded.items).toEqual(stored.items);
      expect(decoded.overlays).toEqual(stored.overlays);
      expect(decoded.visualLayerState).toBeUndefined();
      expect(decoded.extensions).toBeUndefined();
    });

    it("treats null / primitive payloads as a bare items value", () => {
      expect(decodeStoredStoryTimeline(null)).toEqual({ items: null });
      expect(decodeStoredStoryTimeline(undefined)).toEqual({ items: undefined });
    });
  });

  describe("extension slices round-trip byte-for-byte", () => {
    it("collects every non-visual top-level key into extensions", () => {
      const stored = {
        items: [{ stableShotId: "shot-a" }],
        overlays: [{ id: "overlay-a" }],
        visualLayerState: { count: 2, hidden: [1] },
        subtitleTracks: SUBTITLE_SENTINEL,
        audioTracks: AUDIO_SENTINEL,
        __futureUnknownSlice: { anything: true },
      };
      const decoded = decodeStoredStoryTimeline(stored);
      expect(decoded.extensions).toEqual({
        subtitleTracks: SUBTITLE_SENTINEL,
        audioTracks: AUDIO_SENTINEL,
        __futureUnknownSlice: { anything: true },
      });
      expect(encodeStoredStoryTimeline(decoded)).toEqual(stored);
    });

    it("keeps extension slices when overlays and visualLayerState are absent", () => {
      const stored = {
        items: [{ stableShotId: "shot-a" }],
        subtitleTracks: SUBTITLE_SENTINEL,
      };
      const decoded = decodeStoredStoryTimeline(stored);
      expect(decoded.overlays).toBeUndefined();
      expect(decoded.visualLayerState).toBeUndefined();
      expect(encodeStoredStoryTimeline(decoded)).toEqual(stored);
    });
  });

  describe("encode preserves the legacy bare shape only when nothing else is stored", () => {
    it("emits the bare items value with no overlays / vls / extensions", () => {
      const items = [{ stableShotId: "shot-a" }];
      expect(encodeStoredStoryTimeline({ items })).toBe(items);
    });

    it("emits an object once any non-items field is present", () => {
      const items = [{ stableShotId: "shot-a" }];
      expect(
        encodeStoredStoryTimeline({ items, extensions: { subtitleTracks: [] } })
      ).toEqual({ items, subtitleTracks: [] });
    });

    it("drops an extensions bag that only holds undefined slices", () => {
      const items = [{ stableShotId: "shot-a" }];
      expect(
        encodeStoredStoryTimeline({ items, extensions: { subtitleTracks: undefined } })
      ).toBe(items);
    });

    it("is idempotent: encode(decode(x)) === x for every shape", () => {
      for (const stored of [
        [{ stableShotId: "a" }],
        { items: [{ stableShotId: "a" }], overlays: [] },
        { items: [], visualLayerState: { count: 1, hidden: [] } },
        { items: [], subtitleTracks: SUBTITLE_SENTINEL, audioTracks: AUDIO_SENTINEL },
      ]) {
        expect(encodeStoredStoryTimeline(decodeStoredStoryTimeline(stored))).toEqual(
          stored
        );
      }
    });
  });

  describe("mergeStoredStoryTimelineExtensions is field-level", () => {
    it("inherits every stored slice when next provides nothing", () => {
      const current = {
        items: [],
        subtitleTracks: SUBTITLE_SENTINEL,
        audioTracks: AUDIO_SENTINEL,
      };
      expect(mergeStoredStoryTimelineExtensions(current, undefined)).toEqual({
        subtitleTracks: SUBTITLE_SENTINEL,
        audioTracks: AUDIO_SENTINEL,
      });
    });

    it("overrides only the named slice and inherits the rest", () => {
      const current = {
        items: [],
        subtitleTracks: SUBTITLE_SENTINEL,
        audioTracks: AUDIO_SENTINEL,
      };
      const nextSubtitles = [{ id: "sub-2", startFrame: 60, durationFrames: 30, text: "改过" }];
      expect(
        mergeStoredStoryTimelineExtensions(current, { subtitleTracks: nextSubtitles })
      ).toEqual({ subtitleTracks: nextSubtitles, audioTracks: AUDIO_SENTINEL });
    });

    it("clears a slice explicitly set to undefined", () => {
      const current = { items: [], subtitleTracks: SUBTITLE_SENTINEL };
      expect(
        mergeStoredStoryTimelineExtensions(current, { subtitleTracks: undefined })
      ).toBeUndefined();
    });

    it("returns undefined when neither current nor next carry a slice", () => {
      expect(mergeStoredStoryTimelineExtensions([{ stableShotId: "a" }], undefined)).toBeUndefined();
    });
  });

  describe("encodeStoryTimelinePreservingExtensions", () => {
    it("replaces the visual fields while carrying stored slices through", () => {
      const current = {
        items: [{ stableShotId: "old" }],
        overlays: [{ id: "old-overlay" }],
        subtitleTracks: SUBTITLE_SENTINEL,
      };
      const encoded = encodeStoryTimelinePreservingExtensions({
        currentValue: current,
        items: [{ stableShotId: "new" }],
        overlays: [],
      });
      expect(encoded).toEqual({
        items: [{ stableShotId: "new" }],
        overlays: [],
        subtitleTracks: SUBTITLE_SENTINEL,
      });
    });

    it("keeps the bare shape when there is nothing to preserve or add", () => {
      const encoded = encodeStoryTimelinePreservingExtensions({
        currentValue: [{ stableShotId: "old" }],
        items: [{ stableShotId: "new" }],
      });
      expect(encoded).toEqual([{ stableShotId: "new" }]);
    });
  });
});
