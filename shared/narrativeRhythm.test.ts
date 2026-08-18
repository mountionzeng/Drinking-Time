import { describe, it, expect } from "vitest";
import {
  allocateShotDurations,
  applyRhythmNudge,
  computeSegmentPct,
  diagnoseRhythm,
  distributeWithBounds,
  fitBudgetToBeats,
  isNarrativeSpecId,
  NARRATIVE_SPECS,
  NEUTRAL_RHYTHM_PROFILE,
  planRhythmBudget,
  PURPOSE_RHYTHM_ANCHORS,
  resolveTurnShape,
  RHYTHM_BEATS,
  rhythmProfileFromIntent,
  segmentWeight,
  shapeTurnSegment,
  type NarrativeSpecId,
  type RhythmBeat,
  type RhythmProfile,
} from "./narrativeRhythm";

const VIDEO_SPECS: NarrativeSpecId[] = ["video10", "video30", "video50"];
const ALL_SPECS: NarrativeSpecId[] = ["album9", ...VIDEO_SPECS];
const B = (...beats: RhythmBeat[]) => beats;

const beatsFor = (shots: Record<RhythmBeat, number>): RhythmBeat[] => {
  const out: RhythmBeat[] = [];
  RHYTHM_BEATS.forEach(b => {
    for (let i = 0; i < shots[b]; i++) out.push(b);
  });
  return out;
};

describe("rhythmProfileFromIntent —— 意图与节奏之间的唯一耦合面", () => {
  it("意图缺失时返回中性基线，绝不阻塞生成", () => {
    expect(rhythmProfileFromIntent(null)).toEqual(NEUTRAL_RHYTHM_PROFILE);
    expect(rhythmProfileFromIntent(undefined)).toEqual(NEUTRAL_RHYTHM_PROFILE);
    expect(rhythmProfileFromIntent({})).toEqual(NEUTRAL_RHYTHM_PROFILE);
    expect(rhythmProfileFromIntent({ primaryPurpose: null })).toEqual(
      NEUTRAL_RHYTHM_PROFILE
    );
  });

  it("每个意图都映射到自己的锚点", () => {
    for (const purpose of Object.keys(PURPOSE_RHYTHM_ANCHORS) as Array<
      keyof typeof PURPOSE_RHYTHM_ANCHORS
    >) {
      expect(rhythmProfileFromIntent({ primaryPurpose: purpose })).toEqual(
        PURPOSE_RHYTHM_ANCHORS[purpose]
      );
    }
  });

  it("share 比 preserve 更快进快收 —— 发出去的和留给自己的节奏不同", () => {
    const share = rhythmProfileFromIntent({ primaryPurpose: "share" });
    const preserve = rhythmProfileFromIntent({ primaryPurpose: "preserve" });
    expect(share.entryPace).toBeGreaterThan(preserve.entryPace);
    expect(share.landingHold).toBeLessThan(preserve.landingHold);
  });

  it("语气线索能推动维度，但不越界", () => {
    const base = rhythmProfileFromIntent({ primaryPurpose: "create" });
    const light = rhythmProfileFromIntent({
      primaryPurpose: "create",
      tone: "轻松幽默",
    });
    expect(light.entryPace).toBeGreaterThan(base.entryPace);
    expect(light.landingHold).toBeLessThan(base.landingHold);

    const extreme = rhythmProfileFromIntent({
      primaryPurpose: "share",
      tone: "轻松 热烈",
      desiredEffect: "好笑 燃",
    });
    for (const v of Object.values(extreme)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("computeSegmentPct", () => {
  it("中性 + 30s 还原基线盘 15/40/30/15", () => {
    const pct = computeSegmentPct(NEUTRAL_RHYTHM_PROFILE, "video30");
    expect(pct.开场).toBeCloseTo(15, 5);
    expect(pct.起势).toBeCloseTo(40, 5);
    expect(pct.转折).toBeCloseTo(30, 5);
    expect(pct.收束).toBeCloseTo(15, 5);
  });

  it("规格偏移生效：10s 更偏转折，50s 更偏开场", () => {
    const ten = computeSegmentPct(NEUTRAL_RHYTHM_PROFILE, "video10");
    const fifty = computeSegmentPct(NEUTRAL_RHYTHM_PROFILE, "video50");
    expect(ten.转折).toBeCloseTo(35, 5);
    expect(fifty.开场).toBeCloseTo(18, 5);
    expect(fifty.转折).toBeCloseTo(25, 5);
  });

  it("任何参数组合下四段之和恒为 100", () => {
    const dims: Array<keyof RhythmProfile> = [
      "entryPace",
      "landingHold",
      "turnCharacter",
      "amplitude",
      "dwellDensity",
    ];
    for (const specId of ALL_SPECS) {
      for (let t = 0; t <= 1.0001; t += 0.25) {
        for (const dim of dims) {
          const pct = computeSegmentPct(
            { ...NEUTRAL_RHYTHM_PROFILE, [dim]: t },
            specId
          );
          expect(RHYTHM_BEATS.reduce((a, b) => a + pct[b], 0)).toBeCloseTo(100, 5);
        }
      }
    }
  });

  it("极端参数下起势夹到 25%，中段不塌陷", () => {
    const pct = computeSegmentPct(
      { entryPace: 0, landingHold: 1, turnCharacter: 0.5, amplitude: 1, dwellDensity: 0.5 },
      "video30"
    );
    expect(pct.起势).toBeCloseTo(25, 5);
    expect(RHYTHM_BEATS.reduce((a, b) => a + pct[b], 0)).toBeCloseTo(100, 5);
  });

  it("所有意图锚点都不产生负数段", () => {
    for (const [name, profile] of Object.entries(PURPOSE_RHYTHM_ANCHORS)) {
      for (const specId of ALL_SPECS) {
        const pct = computeSegmentPct(profile, specId);
        for (const beat of RHYTHM_BEATS) {
          expect(pct[beat], `${name}/${specId}/${beat}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("distributeWithBounds", () => {
  it("总和守恒且每项落在界内", () => {
    const d = distributeWithBounds([0.1, 5, 0.1], 12_000, [
      [1_000, 8_000],
      [1_000, 8_000],
      [1_000, 8_000],
    ]);
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(12_000, 3);
    for (const x of d) {
      expect(x).toBeGreaterThanOrEqual(1_000 - 1e-6);
      expect(x).toBeLessThanOrEqual(8_000 + 1e-6);
    }
  });

  it("越界项不会被误判为锁死（回归：夹取前判断会让总和偏离目标）", () => {
    // 权重悬殊导致初始分配全部越界，必须仍能收敛到 total
    const d = distributeWithBounds([0.001, 1000, 0.001], 12_000, [
      [1_000, 8_000],
      [1_000, 8_000],
      [1_000, 8_000],
    ]);
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(12_000, 3);
  });

  it("保持权重的相对顺序", () => {
    const d = distributeWithBounds([1, 2, 3], 12_000, new Array(3).fill([1_000, 8_000]));
    expect(d[0]).toBeLessThan(d[1]);
    expect(d[1]).toBeLessThan(d[2]);
  });

  it("无解时不抛错：下限之和超总量 / 上限之和不足总量", () => {
    const tooTight = distributeWithBounds([1, 1, 1], 1_000, new Array(3).fill([1_000, 8_000]));
    expect(tooTight.every(Number.isFinite)).toBe(true);
    const tooLoose = distributeWithBounds([1, 1], 100_000, new Array(2).fill([1_000, 8_000]));
    expect(tooLoose.every(Number.isFinite)).toBe(true);
  });

  it("空输入返回空", () => {
    expect(distributeWithBounds([], 1_000, [])).toEqual([]);
  });
});

describe("planRhythmBudget", () => {
  it("段毫秒之和等于目标总时长", () => {
    for (const specId of VIDEO_SPECS) {
      for (const profile of Object.values(PURPOSE_RHYTHM_ANCHORS)) {
        const b = planRhythmBudget(specId, profile);
        const sum = RHYTHM_BEATS.reduce((a, beat) => a + b.segmentMs[beat], 0);
        expect(sum).toBeCloseTo(NARRATIVE_SPECS[specId].totalMs!, 3);
      }
    }
  });

  it("每段都养得起自己的镜头数，也装得下自己的时间", () => {
    for (const specId of VIDEO_SPECS) {
      const [min, max] = NARRATIVE_SPECS[specId].shotClampMs;
      for (const [name, profile] of Object.entries(PURPOSE_RHYTHM_ANCHORS)) {
        const b = planRhythmBudget(specId, profile);
        for (const beat of RHYTHM_BEATS) {
          const n = b.segmentShots[beat];
          if (n === 0) continue;
          expect(b.segmentMs[beat], `${name}/${specId}/${beat}`).toBeGreaterThanOrEqual(
            n * min - 1e-6
          );
          expect(b.segmentMs[beat], `${name}/${specId}/${beat}`).toBeLessThanOrEqual(
            n * max + 1e-6
          );
        }
      }
    }
  });

  it("镜头数落在规格区间内，且开场/转折/收束各至少 1 镜", () => {
    for (const specId of VIDEO_SPECS) {
      const [lo, hi] = NARRATIVE_SPECS[specId].shotRange;
      for (const profile of Object.values(PURPOSE_RHYTHM_ANCHORS)) {
        const b = planRhythmBudget(specId, profile);
        expect(b.shotCount).toBeGreaterThanOrEqual(lo);
        expect(b.shotCount).toBeLessThanOrEqual(hi);
        expect(
          RHYTHM_BEATS.reduce((a, beat) => a + b.segmentShots[beat], 0)
        ).toBe(b.shotCount);
        expect(b.segmentShots.开场).toBeGreaterThanOrEqual(1);
        expect(b.segmentShots.转折).toBeGreaterThanOrEqual(1);
        expect(b.segmentShots.收束).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("画册档不产生毫秒，只给页数上限", () => {
    const b = planRhythmBudget("album9", NEUTRAL_RHYTHM_PROFILE);
    expect(b.mode).toBe("album");
    expect(b.totalMs).toBeNull();
    expect(b.pageCount).toBe(9);
  });
});

describe("fitBudgetToBeats —— 段落数决定镜头数，预算得适配实际分布", () => {
  it("镜头数与预算不符时重摊时间，总时长不变", () => {
    const budget = planRhythmBudget("video30", NEUTRAL_RHYTHM_PROFILE);
    const beats = B(
      "开场", "起势", "起势", "起势", "起势", "起势",
      "转折", "转折", "转折", "转折", "收束", "收束"
    );
    const fitted = fitBudgetToBeats(budget, beats);
    expect(fitted.shotCount).toBe(12);
    expect(
      RHYTHM_BEATS.reduce((a, b) => a + fitted.segmentMs[b], 0)
    ).toBeCloseTo(30_000, 3);
  });

  it("空段的时间还给非空段，不凭空消失", () => {
    const budget = planRhythmBudget("video30", NEUTRAL_RHYTHM_PROFILE);
    const fitted = fitBudgetToBeats(budget, B("开场", "起势", "起势", "收束"));
    expect(fitted.segmentMs.转折).toBe(0);
    expect(fitted.segmentShots.转折).toBe(0);
    expect(
      RHYTHM_BEATS.reduce((a, b) => a + fitted.segmentMs[b], 0)
    ).toBeCloseTo(30_000, 3);
    expect(fitted.segmentMs.起势).toBeGreaterThan(budget.segmentMs.起势);
  });

  it("镜头分布恰好等于预算时是恒等变换", () => {
    const budget = planRhythmBudget("video30", NEUTRAL_RHYTHM_PROFILE);
    const fitted = fitBudgetToBeats(budget, beatsFor(budget.segmentShots));
    for (const beat of RHYTHM_BEATS) {
      expect(fitted.segmentMs[beat]).toBeCloseTo(budget.segmentMs[beat], 3);
    }
  });
});

describe("segmentWeight —— 文字稿段落没有情绪标注时的兜底", () => {
  it("有浓度时按浓度", () => {
    expect(segmentWeight({ intensity: 0.9 })).toBeGreaterThan(
      segmentWeight({ intensity: 0.2 })
    );
  });

  it("没有浓度时用字数兜底，并压在合理区间内", () => {
    const short = segmentWeight({ textLength: 10 });
    const long = segmentWeight({ textLength: 500 });
    expect(long).toBeGreaterThan(short);
    expect(long).toBeLessThanOrEqual(1.4);
    expect(short).toBeGreaterThanOrEqual(0.7);
  });

  it("承重段与异常点获得更多时间", () => {
    const plain = segmentWeight({ intensity: 0.5 });
    expect(segmentWeight({ intensity: 0.5, loadBearing: true })).toBeGreaterThan(plain);
    expect(segmentWeight({ intensity: 0.5, outlier: true })).toBeGreaterThan(plain);
  });

  it("完全没有信号时取中性权重，仍能排出节奏", () => {
    expect(segmentWeight(undefined)).toBe(1);
    expect(segmentWeight({})).toBe(1);
  });
});

describe("shapeTurnSegment", () => {
  it("翻转让末镜短促，时间还给铺垫", () => {
    const shaped = shapeTurnSegment([3_000, 3_000, 3_000], "翻转", [1_000, 8_000]);
    expect(shaped[shaped.length - 1]).toBeLessThanOrEqual(1_500 + 1e-6);
    expect(shaped[0]).toBeGreaterThan(3_000);
    expect(shaped.reduce((a, b) => a + b, 0)).toBeCloseTo(9_000, 3);
  });

  it("承重让中间那一下最重", () => {
    const shaped = shapeTurnSegment([3_000, 3_000, 3_000], "承重", [1_000, 8_000]);
    expect(shaped[1]).toBeGreaterThan(shaped[0]);
    expect(shaped[1]).toBeGreaterThan(shaped[2]);
    expect(shaped.reduce((a, b) => a + b, 0)).toBeCloseTo(9_000, 3);
  });

  it("中性不改动", () => {
    const flat = [3_000, 3_000, 3_000];
    expect(shapeTurnSegment(flat, "中性", [1_000, 8_000])).toEqual(flat);
  });
});

describe("allocateShotDurations", () => {
  const signals = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      intensity: 0.4 + (i % 3) * 0.2,
      loadBearing: i % 4 === 2,
      outlier: i % 5 === 3,
    }));

  it("所有意图 × 所有视频档，总时长落在容差带内", () => {
    for (const specId of VIDEO_SPECS) {
      for (const [name, profile] of Object.entries(PURPOSE_RHYTHM_ANCHORS)) {
        const budget = planRhythmBudget(specId, profile);
        const beats = beatsFor(budget.segmentShots);
        const plans = allocateShotDurations(budget, beats, signals(beats.length));
        const total = plans.reduce((a, p) => a + (p.durationMs ?? 0), 0);
        const [lo, hi] = budget.toleranceMs!;
        expect(total, `${name}/${specId} → ${total}ms`).toBeGreaterThanOrEqual(lo);
        expect(total, `${name}/${specId} → ${total}ms`).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("每镜时长都在硬边界 100–12000ms 之内", () => {
    for (const specId of VIDEO_SPECS) {
      for (const profile of Object.values(PURPOSE_RHYTHM_ANCHORS)) {
        const budget = planRhythmBudget(specId, profile);
        const beats = beatsFor(budget.segmentShots);
        const plans = allocateShotDurations(budget, beats, signals(beats.length));
        for (const p of plans) {
          expect(p.durationMs!).toBeGreaterThanOrEqual(100);
          expect(p.durationMs!).toBeLessThanOrEqual(12_000);
        }
      }
    }
  });

  it("起止时间首尾相接且单调递增", () => {
    const budget = planRhythmBudget("video30", NEUTRAL_RHYTHM_PROFILE);
    const beats = beatsFor(budget.segmentShots);
    const plans = allocateShotDurations(budget, beats, signals(beats.length));
    expect(plans[0].startMs).toBe(0);
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i].startMs).toBe(plans[i - 1].endMs);
    }
  });

  it("同一批段落，share 与 preserve 产出可辨的不同节奏", () => {
    const paragraphs = 8;
    const beats = B(
      "开场", "起势", "起势", "起势", "转折", "转折", "收束", "收束"
    );
    const sig = signals(paragraphs);

    const sharePlans = allocateShotDurations(
      fitBudgetToBeats(planRhythmBudget("video30", PURPOSE_RHYTHM_ANCHORS.share), beats),
      beats,
      sig
    );
    const preservePlans = allocateShotDurations(
      fitBudgetToBeats(planRhythmBudget("video30", PURPOSE_RHYTHM_ANCHORS.preserve), beats),
      beats,
      sig
    );

    // 开场：share 快进，preserve 慢进
    expect(sharePlans[0].durationMs!).toBeLessThan(preservePlans[0].durationMs!);
    // 收束：share 干脆，preserve 留余韵
    const shareEnd = sharePlans[sharePlans.length - 1].durationMs!;
    const preserveEnd = preservePlans[preservePlans.length - 1].durationMs!;
    expect(shareEnd).toBeLessThan(preserveEnd);
  });

  it("画册档产出阅读权重而非时长", () => {
    const budget = planRhythmBudget("album9", NEUTRAL_RHYTHM_PROFILE);
    const beats = B("开场", "起势", "转折", "收束");
    const plans = allocateShotDurations(budget, beats, signals(4));
    for (const p of plans) {
      expect(p.durationMs).toBeNull();
      expect(p.startMs).toBeNull();
      expect(p.readingWeight).toBeGreaterThan(0);
      expect(p.readingWeight).toBeLessThanOrEqual(1);
    }
  });

  it("段落完全没有情绪标注时仍能排出合规节奏", () => {
    const budget = planRhythmBudget("video30", NEUTRAL_RHYTHM_PROFILE);
    const beats = beatsFor(budget.segmentShots);
    const plans = allocateShotDurations(budget, beats, beats.map(() => undefined));
    const total = plans.reduce((a, p) => a + (p.durationMs ?? 0), 0);
    const [lo, hi] = budget.toleranceMs!;
    expect(total).toBeGreaterThanOrEqual(lo);
    expect(total).toBeLessThanOrEqual(hi);
  });
});

describe("diagnoseRhythm —— 只提示，不自动纠正", () => {
  const budget = planRhythmBudget("video30", NEUTRAL_RHYTHM_PROFILE);
  const beats = beatsFor(budget.segmentShots);
  const base = () =>
    allocateShotDurations(budget, beats, beats.map(() => ({ intensity: 0.5 }))).map(
      p => ({ durationMs: p.durationMs, beat: p.beat })
    );

  it("引擎产出本身在容差带内", () => {
    expect(diagnoseRhythm(base(), budget).level).toBe("ok");
  });

  it("轻微超出 → warn，不建议重排", () => {
    const shots = base();
    shots[0] = { ...shots[0], durationMs: (shots[0].durationMs ?? 0) + 5_000 };
    const d = diagnoseRhythm(shots, budget);
    expect(d.level).toBe("warn");
    expect(d.suggestReflow).toBe(false);
  });

  it("大幅超出 → off，提供重排动作", () => {
    const shots = base();
    shots[0] = { ...shots[0], durationMs: (shots[0].durationMs ?? 0) + 11_000 };
    const d = diagnoseRhythm(shots, budget);
    expect(d.level).toBe("off");
    expect(d.suggestReflow).toBe(true);
  });

  it("镜头太少够不到目标时直说原因", () => {
    const b50 = planRhythmBudget("video50", NEUTRAL_RHYTHM_PROFILE);
    const few = B("开场", "起势", "转折", "收束");
    const plans = allocateShotDurations(b50, few, few.map(() => undefined)).map(p => ({
      durationMs: p.durationMs,
      beat: p.beat,
    }));
    const d = diagnoseRhythm(plans, b50);
    expect(d.level).toBe("off");
    expect(d.message).toContain("镜头太少");
  });

  it("偏长判定基于同 beat 均值，不会把正常的开场误报", () => {
    const d = diagnoseRhythm(base(), budget);
    expect(d.tooLong).toEqual([]);
    expect(d.tooShort).toEqual([]);
  });

  it("诊断不修改传入的镜头", () => {
    const shots = base();
    const before = shots.map(s => s.durationMs);
    diagnoseRhythm(shots, budget);
    expect(shots.map(s => s.durationMs)).toEqual(before);
  });
});

describe("applyRhythmNudge —— 模糊反馈落成连续推动", () => {
  it("「太拖了」推快节奏、缩余韵", () => {
    const next = applyRhythmNudge(NEUTRAL_RHYTHM_PROFILE, "太拖了");
    expect(next.dwellDensity).toBeGreaterThan(NEUTRAL_RHYTHM_PROFILE.dwellDensity);
    expect(next.landingHold).toBeLessThan(NEUTRAL_RHYTHM_PROFILE.landingHold);
  });

  it("「前面有点闷」只动进入速度", () => {
    const next = applyRhythmNudge(NEUTRAL_RHYTHM_PROFILE, "前面有点闷");
    expect(next.entryPace).toBeGreaterThan(NEUTRAL_RHYTHM_PROFILE.entryPace);
    expect(next.amplitude).toBe(NEUTRAL_RHYTHM_PROFILE.amplitude);
  });

  it("反复推动不越出 0–1", () => {
    let p = NEUTRAL_RHYTHM_PROFILE;
    for (let i = 0; i < 20; i++) p = applyRhythmNudge(p, "太拖了");
    expect(p.dwellDensity).toBeLessThanOrEqual(1);
    expect(p.landingHold).toBeGreaterThanOrEqual(0);
  });
});

describe("resolveTurnShape / isNarrativeSpecId", () => {
  it("按 turnCharacter 分档", () => {
    expect(resolveTurnShape(0.9)).toBe("翻转");
    expect(resolveTurnShape(0.15)).toBe("承重");
    expect(resolveTurnShape(0.5)).toBe("中性");
  });

  it("规格 id 守卫", () => {
    expect(isNarrativeSpecId("video30")).toBe(true);
    expect(isNarrativeSpecId("video45")).toBe(false);
    expect(isNarrativeSpecId(null)).toBe(false);
  });
});
