/** 重复修正阈值的真实语料复算，按项目隔离并模拟服务端最近 50 条窗口。 */
import { readFileSync } from "node:fs";

import type { EditSnapshot } from "../drizzle/schema";
import {
  changedPromptDimensions,
  computeRecurringEditSignals,
  extractModifiedPairsWithStats,
  RECURRING_EDIT_THRESHOLD,
  TARGETED_EDIT_FIELD_LIMIT,
} from "../server/services/recurringEditSignal";
import { resolveEditSnapshotPath } from "./editSnapshotCorpus";

export type AnalysisSnapshot = Pick<
  EditSnapshot,
  "id" | "projectId" | "timestamp" | "diff"
>;

export type RecurringEditAnalysis = {
  snapshots: number;
  invalidProjectIds: number;
  invalidTimestamps: number;
  invalidSnapshots: number;
  invalidModifiedPairs: number;
  projects: number;
  changedEvents: number;
  changedDimensionHistogram: Record<string, number>;
  medianChangedDimensions: number;
  oneOrTwoDimensionEvents: number;
  targetedEventsAtDefaultLimit: number;
  bulkEventsAtDefaultLimit: number;
  recurringThreshold: number;
  runtimeWindowPerProject: number;
  signalsByFieldLimit: Array<{
    fieldLimit: number;
    allHistory: number;
    runtimeWindow: number;
  }>;
};

function hasStableShotId(pair: {
  old: Record<string, unknown> | null;
  new: Record<string, unknown> | null;
}): boolean {
  const id = pair.old?.stableShotId ?? pair.new?.stableShotId;
  return typeof id === "string" && id.length > 0;
}

export function analyzeRecurringEditSnapshots(
  snapshots: readonly AnalysisSnapshot[],
  options: {
    fieldLimits?: readonly number[];
    runtimeWindowPerProject?: number;
    invalidProjectIds?: number;
    invalidTimestamps?: number;
    invalidSnapshots?: number;
  } = {}
): RecurringEditAnalysis {
  const fieldLimits = options.fieldLimits ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const runtimeWindowPerProject = options.runtimeWindowPerProject ?? 50;
  const changedCounts: number[] = [];
  let invalidModifiedPairs = 0;

  snapshots.forEach(snapshot => {
    const extracted = extractModifiedPairsWithStats(snapshot.diff);
    invalidModifiedPairs += extracted.invalidCount;
    extracted.pairs.forEach(pair => {
      if (!hasStableShotId(pair)) return;
      const count = changedPromptDimensions(pair).length;
      if (count > 0) changedCounts.push(count);
    });
  });

  const histogram: Record<string, number> = {};
  changedCounts.forEach(count => {
    histogram[String(count)] = (histogram[String(count)] ?? 0) + 1;
  });
  const sortedCounts = [...changedCounts].sort((left, right) => left - right);
  const midpoint = Math.floor(sortedCounts.length / 2);

  const byProject = new Map<number, AnalysisSnapshot[]>();
  snapshots.forEach(snapshot => {
    const group = byProject.get(snapshot.projectId) ?? [];
    group.push(snapshot);
    byProject.set(snapshot.projectId, group);
  });
  const runtimeByProject = Array.from(byProject.values()).map(group =>
    [...group]
      .sort((left, right) => {
        const timeDelta = right.timestamp.getTime() - left.timestamp.getTime();
        return timeDelta !== 0 ? timeDelta : right.id - left.id;
      })
      .slice(0, runtimeWindowPerProject)
  );

  const countSignals = (
    groups: readonly (readonly AnalysisSnapshot[])[],
    fieldLimit: number
  ) =>
    groups.reduce(
      (total, group) =>
        total +
        computeRecurringEditSignals(group, RECURRING_EDIT_THRESHOLD, fieldLimit)
          .length,
      0
    );

  return {
    snapshots: snapshots.length,
    invalidProjectIds: options.invalidProjectIds ?? 0,
    invalidTimestamps: options.invalidTimestamps ?? 0,
    invalidSnapshots: options.invalidSnapshots ?? 0,
    invalidModifiedPairs,
    projects: byProject.size,
    changedEvents: changedCounts.length,
    changedDimensionHistogram: histogram,
    medianChangedDimensions:
      sortedCounts.length === 0
        ? 0
        : sortedCounts.length % 2 === 1
          ? sortedCounts[midpoint]
          : (sortedCounts[midpoint - 1] + sortedCounts[midpoint]) / 2,
    oneOrTwoDimensionEvents: changedCounts.filter(count => count <= 2).length,
    targetedEventsAtDefaultLimit: changedCounts.filter(
      count => count <= TARGETED_EDIT_FIELD_LIMIT
    ).length,
    bulkEventsAtDefaultLimit: changedCounts.filter(
      count => count > TARGETED_EDIT_FIELD_LIMIT
    ).length,
    recurringThreshold: RECURRING_EDIT_THRESHOLD,
    runtimeWindowPerProject,
    signalsByFieldLimit: fieldLimits.map(fieldLimit => ({
      fieldLimit,
      allHistory: countSignals(Array.from(byProject.values()), fieldLimit),
      runtimeWindow: countSignals(runtimeByProject, fieldLimit),
    })),
  };
}

export function loadRecurringEditAnalysis(path?: string): {
  path: string;
  report: RecurringEditAnalysis;
} {
  const resolvedPath = resolveEditSnapshotPath(path);
  const raw = JSON.parse(readFileSync(resolvedPath, "utf8"));
  const entries: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? Object.values(raw)
      : [];
  const {
    snapshots,
    invalidProjectIds,
    invalidTimestamps,
    invalidSnapshots,
  } = parseAnalysisSnapshots(entries);
  return {
    path: resolvedPath,
    report: analyzeRecurringEditSnapshots(snapshots, {
      invalidProjectIds,
      invalidTimestamps,
      invalidSnapshots,
    }),
  };
}

export function parseAnalysisSnapshots(entries: readonly unknown[]): {
  snapshots: AnalysisSnapshot[];
  invalidProjectIds: number;
  invalidTimestamps: number;
  invalidSnapshots: number;
} {
  const snapshots: AnalysisSnapshot[] = [];
  let invalidProjectIds = 0;
  let invalidTimestamps = 0;
  let invalidSnapshots = 0;
  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      invalidSnapshots += 1;
      return;
    }
    const value = entry as Record<string, unknown>;
    if (
      typeof value.projectId !== "number" ||
      !Number.isSafeInteger(value.projectId) ||
      value.projectId <= 0
    ) {
      invalidProjectIds += 1;
      return;
    }
    const id = value.id == null ? index + 1 : value.id;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
      invalidSnapshots += 1;
      return;
    }
    const timestamp = new Date(
      typeof value.timestamp === "string" || typeof value.timestamp === "number"
        ? value.timestamp
        : Number.NaN
    );
    if (!Number.isFinite(timestamp.getTime())) {
      invalidTimestamps += 1;
      return;
    }
    snapshots.push({
      id,
      projectId: value.projectId,
      timestamp,
      diff: value.diff as EditSnapshot["diff"],
    });
  });
  return {
    snapshots,
    invalidProjectIds,
    invalidTimestamps,
    invalidSnapshots,
  };
}
