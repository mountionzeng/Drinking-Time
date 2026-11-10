import { describe, expect, it } from "vitest";
import { appendVideoEditRevision } from "./videoEditHistory";
import { encodeStoredStoryTimeline } from "./storyTimelinePersistence";
import { readVideoEditHistory } from "../../shared/videoEditHistory";

describe("video editing revisions", () => {
  const body = {
    shots: [
      {
        stableShotId: "a",
        cueCode: "0101",
        dialogue: "保留台词",
        publishingVideo: { referenceImageIds: [7, 8] },
      },
    ],
  };
  it("captures the legacy baseline and changed media without recursive history", () => {
    const current = {
      items: [{ stableShotId: "a", timelineStartFrame: 0, imageId: 7 }],
      extensions: { subtitleTracks: { cues: [1] }, audioTracks: { cues: [2] } },
    };
    const next = appendVideoEditRevision({
      currentValue: encodeStoredStoryTimeline(current),
      currentVersion: 4,
      previousStoryBody: body,
      nextStoryBody: body,
      savedAt: 1,
      next: {
        ...current,
        items: [{ stableShotId: "a", timelineStartFrame: 90, imageId: 7 }],
      },
    });
    const history = readVideoEditHistory(next.extensions?.videoEditHistory);
    expect(history.map(entry => entry.version)).toEqual([4, 5]);
    expect(history[0].timeline.items).toEqual(current.items);
    expect(history[1].timeline.items).toEqual(next.items);
    expect(history[1].timeline.extensions).toEqual(current.extensions);
    body.shots[0].publishingVideo.referenceImageIds.push(9);
    expect(history[1].shots[0]).toMatchObject({
      publishingVideo: { referenceImageIds: [7, 8] },
    });
    body.shots[0].publishingVideo.referenceImageIds.pop();
    expect(JSON.stringify(history)).not.toContain("videoEditHistory");
  });
  it("retains only thirty immutable revisions and skips unchanged content", () => {
    let current = { items: [], extensions: {} } as ReturnType<
      typeof appendVideoEditRevision
    >;
    for (let i = 0; i < 40; i++)
      current = appendVideoEditRevision({
        currentValue: encodeStoredStoryTimeline(current),
        currentVersion: i,
        previousStoryBody: body,
        nextStoryBody: body,
        next: { ...current, items: [{ position: i }] },
        savedAt: i,
      });
    const history = readVideoEditHistory(current.extensions?.videoEditHistory);
    expect(history).toHaveLength(30);
    expect(history[0].version).toBe(11);
    expect(history.at(-1)?.version).toBe(40);
    expect(JSON.stringify(history)).not.toContain("videoEditHistory");
    const unchanged = appendVideoEditRevision({
      currentValue: encodeStoredStoryTimeline(current),
      currentVersion: 40,
      previousStoryBody: body,
      nextStoryBody: body,
      next: current,
      savedAt: 50,
    });
    expect(
      readVideoEditHistory(unchanged.extensions?.videoEditHistory)
    ).toEqual(history);
  });
});
