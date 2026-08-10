import { describe, expect, it } from "vitest";

import {
  computeDimensionSignals,
  computeWeightEditAlignment,
  findMisalignedDimensions,
} from "./dimensionWeightSignal";
import type { ShotEditFacts } from "./editSnapshotCorpus";

function facts(id: string, present: string[], edited: string[]): ShotEditFacts {
  return {
    projectId: 1,
    stableShotId: id,
    presentDimensions: new Set(present),
    editedDimensions: new Set(edited),
  };
}

describe("computeDimensionSignals", () => {
  it("算出编辑率 = 改过的镜头数 / 出现过该维度的镜头数", () => {
    const shots = new Map([
      ["a", facts("a", ["subject"], ["subject"])],
      ["b", facts("b", ["subject"], [])],
      ["c", facts("c", ["subject"], ["subject"])],
      ["d", facts("d", ["subject"], [])],
    ]);
    const [signal] = computeDimensionSignals(shots);
    expect(signal.dimension).toBe("subject");
    expect(signal.shotsWithField).toBe(4);
    expect(signal.shotsEdited).toBe(2);
    expect(signal.editRate).toBeCloseTo(0.5);
  });

  it("按编辑率降序排列", () => {
    const shots = new Map([
      ["a", facts("a", ["low", "high"], ["high"])],
    ]);
    const signals = computeDimensionSignals(shots);
    expect(signals[0].dimension).toBe("high");
  });

  it("标出落到默认权重的维度", () => {
    const shots = new Map([["a", facts("a", ["undefinedDim"], [])]]);
    const [signal] = computeDimensionSignals(shots);
    expect(signal.hasExplicitWeight).toBe(false);
  });

  it("默认权重策略变化会让专门的权重证据分数变化", () => {
    const shots = new Map<string, ShotEditFacts>();
    for (let index = 0; index < 10; index += 1) {
      shots.set(
        `shot-${index}`,
        facts(
          `shot-${index}`,
          ["style_reference", "mood", "location"],
          [
            ...(index < 8 ? ["style_reference"] : []),
            ...(index < 5 ? ["mood"] : []),
            ...(index < 2 ? ["location"] : []),
          ],
        ),
      );
    }

    const underweighted = computeDimensionSignals(shots, dimension =>
      dimension === "style_reference" ? 0.1 : dimension === "mood" ? 0.3 : 0.2,
    );
    const corrected = computeDimensionSignals(shots, dimension =>
      dimension === "style_reference" ? 0.4 : dimension === "mood" ? 0.3 : 0.2,
    );

    expect(computeWeightEditAlignment(corrected).score).toBeGreaterThan(
      computeWeightEditAlignment(underweighted).score,
    );
  });
});

describe("findMisalignedDimensions", () => {
  it("编辑率高、权重排名低的维度标记为 underweighted", () => {
    // 用真实维度键（有显式权重），构造样本量达标(>=8)的场景
    const shots = new Map<string, ShotEditFacts>();
    // style_reference: 高编辑率，权重低（0.26）
    for (let i = 0; i < 8; i += 1) {
      shots.set(`sr-${i}`, facts(`sr-${i}`, ["style_reference"], i < 7 ? ["style_reference"] : []));
    }
    // intent: 低编辑率，权重高（0.5）——制造反向错配
    for (let i = 0; i < 8; i += 1) {
      shots.set(`in-${i}`, facts(`in-${i}`, ["intent"], i < 1 ? ["intent"] : []));
    }
    const signals = computeDimensionSignals(shots);
    const misaligned = findMisalignedDimensions(signals, { minShots: 8, minRankGap: 1 });
    const byDim = new Map(misaligned.map(m => [m.dimension, m]));
    expect(byDim.get("style_reference")?.direction).toBe("underweighted");
    expect(byDim.get("intent")?.direction).toBe("overweighted");
  });

  it("样本量低于阈值的维度不参与判定，避免小样本噪音", () => {
    const shots = new Map<string, ShotEditFacts>([
      ["a", facts("a", ["rare_dimension"], ["rare_dimension"])],
    ]);
    const signals = computeDimensionSignals(shots);
    const misaligned = findMisalignedDimensions(signals, { minShots: 8 });
    expect(misaligned).toHaveLength(0);
  });

  it("排名差在容忍范围内时不报告——避免把噪音当成信号", () => {
    const shots = new Map<string, ShotEditFacts>();
    for (let i = 0; i < 10; i += 1) {
      shots.set(`a-${i}`, facts(`a-${i}`, ["mood"], i < 5 ? ["mood"] : []));
      shots.set(`b-${i}`, facts(`b-${i}`, ["location"], i < 4 ? ["location"] : []));
    }
    const signals = computeDimensionSignals(shots);
    // mood(0.3) 和 location(0.32) 权重接近、编辑率也接近——不该被判定错配
    const misaligned = findMisalignedDimensions(signals, { minShots: 8, minRankGap: 5 });
    expect(misaligned.find(m => m.dimension === "mood" || m.dimension === "location")).toBeUndefined();
  });
});
