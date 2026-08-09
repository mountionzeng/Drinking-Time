import { describe, expect, it } from "vitest";

import { applyGoldenSet, freezeGoldenSet } from "./corpus";
import type { EvalSample, GoldenSet } from "./types";

function sample(storyId: number, stableShotId: string): EvalSample {
  return {
    storyId,
    stableShotId,
    modality: "image",
    finalText: "x",
    dimensions: [],
    contentByDimension: {},
    sourceByDimension: {},
  };
}

describe("freezeGoldenSet", () => {
  it("按镜头去重（三个模态只记一个镜头）", () => {
    const golden = freezeGoldenSet([
      { ...sample(1, "a"), modality: "image" },
      { ...sample(1, "a"), modality: "video" },
      { ...sample(1, "a"), modality: "dialogue" },
      sample(1, "b"),
    ]);
    expect(golden.shots).toHaveLength(2);
  });

  it("排序稳定，避免无意义的 diff", () => {
    const golden = freezeGoldenSet([
      sample(2, "b"),
      sample(1, "z"),
      sample(1, "a"),
    ]);
    expect(golden.shots.map(shot => `${shot.storyId}/${shot.stableShotId}`)).toEqual([
      "1/a",
      "1/z",
      "2/b",
    ]);
  });
});

describe("applyGoldenSet", () => {
  const golden: GoldenSet = {
    frozenAt: "2026-08-09T00:00:00.000Z",
    shots: [
      { storyId: 1, stableShotId: "a" },
      { storyId: 1, stableShotId: "b" },
    ],
  };

  it("只保留 golden set 内的样本", () => {
    const result = applyGoldenSet(
      [sample(1, "a"), sample(1, "b"), sample(9, "new")],
      golden,
    );
    expect(result.samples).toHaveLength(2);
    expect(result.drift.missing).toHaveLength(0);
    expect(result.drift.extra).toBe(1);
  });

  it("镜头消失时报告漂移", () => {
    const result = applyGoldenSet([sample(1, "a")], golden);
    expect(result.drift.missing).toEqual([{ storyId: 1, stableShotId: "b" }]);
  });

  it("语料整体换掉时，漂移覆盖全部 golden 镜头", () => {
    const result = applyGoldenSet([sample(77, "x")], golden);
    expect(result.samples).toHaveLength(0);
    expect(result.drift.missing).toHaveLength(2);
  });
});
