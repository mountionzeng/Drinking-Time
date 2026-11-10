import { describe, expect, it } from "vitest";
import { shotChangeHistory } from "./shotChangeHistory";
import { recordStoryboardFieldVersions } from "./storyboardFieldVersions";
import type { ChatImageRevision } from "./chatImageRevision";
import type { VideoTakeAsset } from "./videoAsset";

const target = { storyId: 1, stableShotId: "a" };
describe("per-shot history", () => {
  it("recovers saved video previews only for the same story and stable shot", () => {
    const take = {
      id: 7,
      storyId: 1,
      stableShotId: "a",
      status: "available",
      createdAt: "2026-11-09T10:00:00Z",
      prompt: "bright",
      videoUrl: "/7.mp4",
      isTimelineSelected: false,
    } as VideoTakeAsset;
    const history = shotChangeHistory({
      ...target,
      takes: [
        take,
        { ...take, id: 8, storyId: 2 },
        { ...take, id: 9, stableShotId: "b" },
      ],
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      title: "生成视频",
      video: { takeId: 7, url: "/7.mp4", selected: false },
    });
  });
  it("shows before/after only for changes to the stable target, across reorder", () => {
    const before = [
      { stableShotId: "a", shotNo: 1, promptDraft: "warm" },
      { stableShotId: "b", shotNo: 2, promptDraft: "blue" },
    ];
    const after = [
      { ...before[1], shotNo: 1, promptDraft: "green" },
      { ...before[0], shotNo: 2 },
    ];
    let fields = recordStoryboardFieldVersions({
      beforeShots: before,
      afterShots: after,
      state: null,
      fields: ["promptDraft"],
      now: 100,
      source: "edited",
    });
    fields = recordStoryboardFieldVersions({
      beforeShots: after,
      afterShots: [after[0], { ...after[1], promptDraft: "bright" }],
      state: fields,
      fields: ["promptDraft"],
      now: 200,
      source: "edited",
    });
    const history = shotChangeHistory({ ...target, fields });
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      before: "warm",
      after: "bright",
      at: 200,
    });
    expect(JSON.stringify(history)).not.toMatch(/blue|green/);
  });

  it("labels retained legacy snapshots without inventing original edit times", () => {
    const snapshot = (version: number, text: string, shotNo: number) => ({
      version,
      savedAt: version * 100,
      shots: [
        { stableShotId: "a", shotNo, promptDraft: text, durationMs: 1000 },
      ],
      timeline: {
        items: [{ stableShotId: "a", shotNo, referencedImageId: 9 }],
      },
    });
    const videoHistory = {
      schemaVersion: 1,
      revisions: [
        snapshot(1, "old", 1),
        snapshot(2, "old", 2),
        snapshot(3, "new", 2),
      ],
    };
    const history = shotChangeHistory({ ...target, videoHistory });
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      snapshot: true,
      before: "old",
      after: "new",
      at: 300,
    });
    expect(history.every(h => h.snapshot)).toBe(true);
  });

  it("distinguishes requests from completed edits and refuses cross-story/number-only attribution", () => {
    const message = {
      id: "m",
      role: "user",
      content: "brighter",
      timestamp: 42,
    };
    const history = shotChangeHistory({
      ...target,
      messages: [
        { ...message, selectionQuote: target },
        {
          ...message,
          id: "wrong-shot",
          selectionQuote: { ...target, stableShotId: "b" },
        },
        {
          ...message,
          id: "wrong-story",
          selectionQuote: { ...target, storyId: 2 },
        },
        { ...message, id: "unbound" },
      ],
    });
    expect(history).toEqual([
      { id: "message:m", at: 42, title: "对话要求", instruction: "brighter" },
    ]);
    expect(shotChangeHistory({ ...target, stableShotId: "" })).toEqual([]);
  });

  it("does not invent adoption events from legacy image membership", () => {
    const image: ChatImageRevision = {
      requestId: "image:9",
      stableShotId: "a",
      shotNo: 1,
      sourceImageId: 8,
      createdAt: 10,
      instruction: "colorful",
      status: "succeeded",
      candidates: [{ imageId: 9, imageUrl: "/9.png" }],
      decision: { kind: "replaced", imageId: 9, at: 10, userId: 1 },
    };
    const history = shotChangeHistory({
      ...target,
      images: [
        image,
        {
          ...image,
          requestId: "real-task",
          decision: { ...image.decision!, at: 20 },
        },
        { ...image, requestId: "other", stableShotId: "b" },
      ],
    });
    expect(history).toHaveLength(3);
    expect(history.filter(h => h.title === "采用图片")).toHaveLength(1);
    expect(history[0].at).toBe(20);
    expect(
      history.find(h => h.title === "历史图片")?.images?.[0].imageUrl
    ).toBe("/9.png");
  });
});
