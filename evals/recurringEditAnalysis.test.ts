import { describe, expect, it } from "vitest";

import {
  analyzeRecurringEditSnapshots,
  parseAnalysisSnapshots,
  type AnalysisSnapshot,
} from "./recurringEditAnalysis";

function snapshot(
  id: number,
  projectId: number,
  oldMood: string,
  newMood: string
): AnalysisSnapshot {
  return {
    id,
    projectId,
    timestamp: new Date(`2026-08-0${id}T00:00:00Z`),
    diff: {
      shots: {
        modified: [
          {
            old: { stableShotId: "same", mood: oldMood },
            new: { stableShotId: "same", mood: newMood },
          },
        ],
      },
    },
  };
}

describe("analyzeRecurringEditSnapshots", () => {
  it("按项目隔离实时信号，避免同镜头编号跨项目凑够重复阈值", () => {
    const report = analyzeRecurringEditSnapshots(
      [snapshot(1, 10, "冷", "暖"), snapshot(2, 20, "暗", "亮")],
      { fieldLimits: [3] }
    );

    expect(report.changedDimensionHistogram).toEqual({ "1": 2 });
    expect(report.signalsByFieldLimit).toEqual([
      { fieldLimit: 3, allHistory: 0, runtimeWindow: 0 },
    ]);
  });

  it("同项目同维度反复修改会产生信号", () => {
    const report = analyzeRecurringEditSnapshots(
      [snapshot(1, 10, "冷", "暖"), snapshot(2, 10, "暖", "亮")],
      { fieldLimits: [3] }
    );
    expect(report.signalsByFieldLimit[0]).toEqual({
      fieldLimit: 3,
      allHistory: 1,
      runtimeWindow: 1,
    });
  });

  it("偶数个事件取两个中项的平均数", () => {
    const narrow = snapshot(1, 10, "冷", "暖");
    const broad = snapshot(2, 10, "暖", "亮");
    broad.diff = {
      shots: {
        modified: [
          {
            old: { stableShotId: "other", mood: "冷" },
            new: {
              stableShotId: "other",
              mood: "暖",
              subject: "人",
              action: "走",
            },
          },
        ],
      },
    };

    expect(
      analyzeRecurringEditSnapshots([narrow, broad]).medianChangedDimensions
    ).toBe(2);
  });

  it("非法 projectId 和时间戳会被跳过，不合并或弄崩分析", () => {
    const raw = [
      null,
      "bad",
      { ...snapshot(1, 10, "冷", "暖"), projectId: "10" },
      { ...snapshot(2, 20, "暖", "亮"), projectId: "20" },
      { ...snapshot(3, 30, "亮", "暗"), projectId: -1 },
      {
        ...snapshot(4, 40, "暗", "冷"),
        projectId: 40,
        timestamp: "2026-08-04T00:00:00.000Z",
      },
      {
        ...snapshot(5, 50, "冷", "暖"),
        timestamp: "not-a-timestamp",
      },
      {
        ...snapshot(6, 60, "冷", "暖"),
        id: Number.NaN,
        timestamp: "2026-08-06T00:00:00.000Z",
      },
    ];
    const parsed = parseAnalysisSnapshots(raw);
    const report = analyzeRecurringEditSnapshots(parsed.snapshots, {
      fieldLimits: [3],
      invalidProjectIds: parsed.invalidProjectIds,
      invalidTimestamps: parsed.invalidTimestamps,
      invalidSnapshots: parsed.invalidSnapshots,
    });

    expect(parsed.snapshots.map(item => item.projectId)).toEqual([40]);
    expect(report.invalidProjectIds).toBe(3);
    expect(report.invalidTimestamps).toBe(1);
    expect(report.invalidSnapshots).toBe(3);
    expect(report.projects).toBe(1);
    expect(report.signalsByFieldLimit[0]).toEqual({
      fieldLimit: 3,
      allHistory: 0,
      runtimeWindow: 0,
    });
  });

  it("损坏的 modified pair 会被跳过并计数", () => {
    const valid = snapshot(1, 10, "冷", "暖");
    const modified = valid.diff?.shots?.modified ?? [];
    valid.diff = { shots: { modified: [null, "bad", ...modified] } } as never;

    const report = analyzeRecurringEditSnapshots([valid]);

    expect(report.changedEvents).toBe(1);
    expect(report.invalidModifiedPairs).toBe(2);
  });
});
