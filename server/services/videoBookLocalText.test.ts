import { expect, it } from "vitest";
import {
  buildLocalVideoTextChapters,
  pickVideoTextSources,
} from "./videoBookLocalText";
import { DEFAULT_TIMELINE_TRANSFORM } from "../../shared/storyMaterial";
const material: any = {
  timeline: {
    items: [
      {
        stableShotId: "s",
        position: 0,
        plannedDurationMs: 5000,
        transform: DEFAULT_TIMELINE_TRANSFORM,
        imageClips: [
          {
            imageUrl: "/api/images/text.png",
            label: "txt-01.png",
            timelineStartFrame: 60,
            durationFrames: 90,
            visualLayer: 1,
          },
          {
            imageUrl: "/api/images/scene.png",
            label: "scene.png",
            timelineStartFrame: 0,
            durationFrames: 90,
            visualLayer: 0,
          },
        ],
      },
    ],
    extensions: { subtitleTracks: { tracks: [] } },
  },
};
it("only uses caption sources on the current timeline, not unrelated artwork", () => {
  expect(pickVideoTextSources(material)).toEqual([
    { imageUrl: "/api/images/text.png", startFrame: 60, label: "txt-01.png" },
  ]);
});
it("retains every extracted paragraph verbatim without inventing product facts", () => {
  const chapters = buildLocalVideoTextChapters("影片", [
    { startFrame: 60, text: "一段原文。" },
    { startFrame: 90, text: "另一段原文。" },
  ]);
  expect(chapters).toEqual({
    chapters: [
      {
        title: "影片",
        modules: [
          { format: "text", text: "一段原文。", parent: null },
          { format: "text", text: "另一段原文。", parent: null },
        ],
      },
    ],
  });
});
it("rejects empty local extraction instead of creating an empty version", () => {
  expect(() => buildLocalVideoTextChapters("影片", [])).toThrow("没有读到");
});

it("does not silently truncate caption sources", () => {
  const oversized = structuredClone(material);
  oversized.timeline.items[0].imageClips = Array.from(
    { length: 101 },
    (_, i) => ({
      ...material.timeline.items[0].imageClips[0],
      timelineStartFrame: i * 30,
    })
  );
  expect(() => pickVideoTextSources(oversized)).toThrow("超过本次上限");
});
