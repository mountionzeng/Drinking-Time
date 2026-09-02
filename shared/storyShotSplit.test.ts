import { describe, expect, it } from "vitest";
import { splitStoryShotAtIndex } from "./storyShotEditing";

describe("splitStoryShotAtIndex", () => {
  it("keeps the left identity and creates an independently addressable right shot", () => {
    const result = splitStoryShotAtIndex({
      shots: [
        { shotNo: 1, stableShotId: "shot-a", subject: "A" },
        {
          shotNo: 2,
          stableShotId: "shot-b",
          shotIdentity: "shot-b",
          shotKey: "shot-b",
          subject: "B",
          durationMs: 2_000,
        },
        { shotNo: 3, stableShotId: "shot-c", subject: "C" },
      ],
      index: 1,
      rightStableShotId: "split-right",
      leftDurationMs: 800,
      rightDurationMs: 1_200,
    });

    expect(result?.shots).toHaveLength(4);
    expect(result?.shots.map(shot => shot.shotNo)).toEqual([1, 2, 3, 4]);
    expect(result?.shots[1]).toMatchObject({
      stableShotId: "shot-b",
      durationMs: 800,
    });
    expect(result?.shots[2]).toMatchObject({
      stableShotId: "split-right",
      shotIdentity: "split-right",
      shotKey: "split-right",
      splitSourceStableShotId: "shot-b",
      durationMs: 1_200,
      subject: "B",
    });
    expect(result?.shots[1]).not.toBe(result?.shots[2]);
  });

  it("rejects an invalid index or duplicate right identity", () => {
    const shots = [
      { shotNo: 1, stableShotId: "shot-a" },
      { shotNo: 2, stableShotId: "shot-b" },
    ];
    expect(
      splitStoryShotAtIndex({
        shots,
        index: -1,
        rightStableShotId: "split-right",
        leftDurationMs: 500,
        rightDurationMs: 500,
      })
    ).toBeNull();
    expect(
      splitStoryShotAtIndex({
        shots,
        index: 0,
        rightStableShotId: "shot-b",
        leftDurationMs: 500,
        rightDurationMs: 500,
      })
    ).toBeNull();
  });
});
