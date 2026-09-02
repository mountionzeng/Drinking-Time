import { describe, expect, it } from "vitest";
import {
  applyFinishedProductCommand,
  completedFinishedProductLabels,
  emptyFinishedProductState,
  normalizeFinishedProductImageSnapshot,
  normalizeFinishedProductVideoSnapshot,
  replaceFinishedProductLayer,
  type FinishedProductVersion,
} from "./finishedProductVersion";

const completed = (
  sequence: number,
  imageIds: number[],
  takeIds: number[]
): FinishedProductVersion => ({
  id: `finished-${sequence}`,
  sequence,
  status: "completed",
  purpose: `第 ${sequence} 版`,
  textVersionId: `v${sequence}`,
  images: imageIds.map((imageId, index) => ({
    stableShotId: `shot-${index + 1}`,
    imageId,
  })),
  videos: takeIds.map((takeId, index) => ({
    stableShotId: `shot-${index + 1}`,
    role: "primary",
    takeId,
    sourceStartSec: 0,
    sourceEndSec: 3,
  })),
  imageVersion: null,
  videoVersion: null,
  createdAt: sequence,
  updatedAt: sequence,
  completedAt: sequence,
});

describe("finished product version snapshots", () => {
  it("normalizes image and video references into deterministic, deduplicated snapshots", () => {
    expect(
      normalizeFinishedProductImageSnapshot([
        { stableShotId: " shot-b ", imageId: 22 },
        { stableShotId: "shot-a", imageId: 11 },
        { stableShotId: "shot-a", imageId: 11 },
        { stableShotId: "", imageId: 99 },
      ])
    ).toEqual([
      { stableShotId: "shot-a", imageId: 11 },
      { stableShotId: "shot-b", imageId: 22 },
    ]);

    expect(
      normalizeFinishedProductVideoSnapshot([
        {
          stableShotId: "shot-b",
          role: "visual_clip",
          clipId: "clip-2",
          takeId: 202,
          rangeId: 9,
          sourceStartSec: 1,
          sourceEndSec: 4,
        },
        {
          stableShotId: "shot-a",
          role: "primary",
          takeId: 101,
          sourceStartSec: 0,
          sourceEndSec: 3,
        },
        {
          stableShotId: "shot-a",
          role: "primary",
          takeId: 101,
          sourceStartSec: 0,
          sourceEndSec: 3,
        },
      ])
    ).toEqual([
      {
        stableShotId: "shot-a",
        role: "primary",
        takeId: 101,
        sourceStartSec: 0,
        sourceEndSec: 3,
      },
      {
        stableShotId: "shot-b",
        role: "visual_clip",
        clipId: "clip-2",
        takeId: 202,
        rangeId: 9,
        sourceStartSec: 1,
        sourceEndSec: 4,
      },
    ]);
  });

  it("changes only the explicitly saved layer", () => {
    const before = completed(1, [11, 22], [101, 202]);
    const after = replaceFinishedProductLayer(before, "text", {
      textVersionId: "v4",
    });

    expect(after.textVersionId).toBe("v4");
    expect(after.images).toEqual(before.images);
    expect(after.videos).toEqual(before.videos);
    expect(after.images).not.toBe(before.images);
    expect(after.videos).not.toBe(before.videos);
  });

  it("assigns media numbers only from completed history and reuses equal snapshots", () => {
    const rows = [
      completed(1, [11, 22], [101]),
      completed(2, [11, 22], [101]),
      completed(3, [33], [303]),
      {
        ...completed(4, [44], [404]),
        status: "editing" as const,
        completedAt: null,
      },
    ];
    rows[1].images = [...rows[1].images].reverse();

    expect(completedFinishedProductLabels(rows)).toEqual([
      { id: "finished-1", imageVersion: 1, videoVersion: 1 },
      { id: "finished-2", imageVersion: 1, videoVersion: 1 },
      { id: "finished-3", imageVersion: 2, videoVersion: 2 },
      { id: "finished-4", imageVersion: null, videoVersion: null },
    ]);
  });

  it("keeps empty media layers explicit instead of inventing V1", () => {
    const row = completed(1, [], []);
    expect(completedFinishedProductLabels([row])).toEqual([
      { id: "finished-1", imageVersion: null, videoVersion: null },
    ]);
  });

  it("creates one editing row and then replaces only explicit layers", () => {
    const first = applyFinishedProductCommand(
      emptyFinishedProductState(),
      {
        type: "save_layer",
        layer: "text",
        purpose: "缩短开场",
        current: {
          textVersionId: "v4",
          images: [{ stableShotId: "shot-a", imageId: 11 }],
          videos: [],
        },
      },
      10
    );
    const second = applyFinishedProductCommand(
      first,
      {
        type: "save_layer",
        layer: "video",
        current: {
          textVersionId: "v5-not-explicit",
          images: [{ stableShotId: "shot-a", imageId: 99 }],
          videos: [
            {
              stableShotId: "shot-a",
              role: "primary",
              takeId: 7,
              sourceStartSec: 0,
              sourceEndSec: 2,
            },
          ],
        },
      },
      11
    );

    expect(second.versions).toHaveLength(1);
    expect(second.versions[0]).toMatchObject({
      sequence: 1,
      status: "editing",
      purpose: "缩短开场",
      textVersionId: "v4",
      images: [{ stableShotId: "shot-a", imageId: 11 }],
      videos: [{ takeId: 7 }],
    });
  });

  it("locks completed rows, creates the next row from the latest completed base, and abandons without deleting references", () => {
    const editing = applyFinishedProductCommand(
      emptyFinishedProductState(),
      {
        type: "save_layer",
        layer: "image",
        purpose: "统一人物形象",
        current: {
          textVersionId: "v3",
          images: [{ stableShotId: "shot-a", imageId: 11 }],
          videos: [],
        },
      },
      10
    );
    const finished = applyFinishedProductCommand(
      editing,
      { type: "complete" },
      11
    );
    const next = applyFinishedProductCommand(
      finished,
      {
        type: "save_layer",
        layer: "text",
        purpose: "提高观看留存",
        current: {
          textVersionId: "v4",
          images: [{ stableShotId: "shot-a", imageId: 99 }],
          videos: [],
        },
      },
      12
    );

    expect(finished.versions[0]).toMatchObject({
      status: "completed",
      imageVersion: 1,
      videoVersion: null,
    });
    expect(next.versions[0]).toEqual(finished.versions[0]);
    expect(next.versions[1]).toMatchObject({
      status: "editing",
      textVersionId: "v4",
      images: [{ stableShotId: "shot-a", imageId: 11 }],
    });
    expect(
      applyFinishedProductCommand(next, { type: "abandon" }, 13).versions
    ).toEqual(finished.versions);
  });

  it("rejects blank purposes and completion without an editing row", () => {
    expect(() =>
      applyFinishedProductCommand(
        emptyFinishedProductState(),
        {
          type: "save_layer",
          layer: "text",
          purpose: "   ",
          current: { textVersionId: "v1", images: [], videos: [] },
        },
        1
      )
    ).toThrow(/purpose/i);
    expect(() =>
      applyFinishedProductCommand(
        emptyFinishedProductState(),
        { type: "complete" },
        1
      )
    ).toThrow(/editing/i);
  });
});
