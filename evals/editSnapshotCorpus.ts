/**
 * 编辑快照语料 —— 从 `.webdev/edit-snapshots-local.json` 读出「用户实际改过哪个字段」。
 *
 * 这是比提示词谱系更直接的监督信号：谱系里 648 条修订有 641 条是迁移产生的
 * （见 evals/README「已知限制」），user authorType 只有 6 条，样本太少。
 * 但编辑快照记录的是**每次保存时镜头字段的 old/new 对比**，是编辑器一直在做的事，
 * 数据量和真实度都够——这才是「用户改了哪个维度」的真实分布。
 *
 * 只读。跟 corpus.ts 一样的路径解析策略（worktree 也能跑）。
 */
import { readFileSync } from "node:fs";

import {
  dimensionForField,
  isPromptDimensionField,
} from "../shared/promptFieldDimensions";
import {
  extractModifiedPairs,
  extractModifiedPairsWithStats,
} from "../server/services/recurringEditSignal";
import { resolveEvalDataPath } from "./localDataPath";

const SNAPSHOT_FILENAME = ".webdev/edit-snapshots-local.json";

export { dimensionForField, isPromptDimensionField };

type EditSnapshot = {
  id: number;
  projectId: number;
  diff?: unknown;
};

/** 一个镜头在其编辑历史里，每个创作字段是否被改过 */
export type ShotEditFacts = {
  projectId: number;
  stableShotId: string;
  /** dimension → 是否在任意一次快照里发生了变化 */
  editedDimensions: Set<string>;
  /** dimension → 该镜头历史上出现过这个字段（不论是否为空） */
  presentDimensions: Set<string>;
};

export function shotEditFactKey(
  projectId: number,
  stableShotId: string,
): string {
  return `${projectId}::${stableShotId}`;
}

function fieldValueKey(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return JSON.stringify(value);
}

export function resolveEditSnapshotPath(explicit?: string): string {
  return resolveEvalDataPath({
    filename: SNAPSHOT_FILENAME,
    description: "编辑快照语料",
    usage:
      "用 --snapshots <路径> 或设 PROMPT_EVAL_EDIT_SNAPSHOTS 指定。",
    explicit,
    environmentPath: process.env.PROMPT_EVAL_EDIT_SNAPSHOTS,
  });
}

/**
 * 把快照流折成「每个镜头 → 哪些维度改过」。
 *
 * 按 (projectId, stableShotId) 聚合而不是按 diff 记录计数：同一个镜头在自动保存间隔里
 * 会产生很多次快照（本地语料里中位数 1 次、最多 48 次），
 * 不去重会让「反复保存同一处修改」的镜头把统计喂歪；只用 stableShotId
 * 又会把不同项目里复用的镜头编号错误合并。
 */
export function buildShotEditFacts(
  snapshots: readonly EditSnapshot[],
): Map<string, ShotEditFacts> {
  const byShot = new Map<string, ShotEditFacts>();

  for (const snapshot of snapshots) {
    const modified = extractModifiedPairs(snapshot.diff);
    for (const pair of modified) {
      const stableShotId = pair.old?.stableShotId ?? pair.new?.stableShotId;
      if (typeof stableShotId !== "string" || !stableShotId) continue;

      const key = shotEditFactKey(snapshot.projectId, stableShotId);
      const facts = byShot.get(key) ?? {
        projectId: snapshot.projectId,
        stableShotId,
        editedDimensions: new Set<string>(),
        presentDimensions: new Set<string>(),
      };

      const fields = new Set([
        ...Object.keys(pair.old ?? {}),
        ...Object.keys(pair.new ?? {}),
      ]);
      fields.forEach(field => {
        if (!isPromptDimensionField(field)) return;
        const dimension = dimensionForField(field);
        const oldValue = fieldValueKey(pair.old?.[field]);
        const newValue = fieldValueKey(pair.new?.[field]);
        // 「present」= 这个字段在 old 或 new 里真的有内容，不是「object 里有这个 key」——
        // 镜头对象里几乎所有字段 key 恒在，值是空字符串时不代表用户用过这个维度。
        if (!oldValue && !newValue) return;
        facts.presentDimensions.add(dimension);
        if (oldValue !== newValue) facts.editedDimensions.add(dimension);
      });

      byShot.set(key, facts);
    }
  }

  return byShot;
}

export function loadEditSnapshotFacts(snapshotsPath?: string): {
  path: string;
  shots: Map<string, ShotEditFacts>;
  snapshotCount: number;
  invalidSnapshots: number;
  invalidModifiedPairs: number;
} {
  const path = resolveEditSnapshotPath(snapshotsPath);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const { snapshots, invalidSnapshots } = parseEditSnapshots(raw);
  const invalidModifiedPairs = snapshots.reduce(
    (total, snapshot) =>
      total + extractModifiedPairsWithStats(snapshot.diff).invalidCount,
    0,
  );
  return {
    path,
    shots: buildShotEditFacts(snapshots),
    snapshotCount: snapshots.length,
    invalidSnapshots,
    invalidModifiedPairs,
  };
}

export function parseEditSnapshots(raw: unknown): {
  snapshots: EditSnapshot[];
  invalidSnapshots: number;
} {
  const entries: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? Object.values(raw)
      : [];
  const snapshots: EditSnapshot[] = [];
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
      invalidSnapshots += 1;
      return;
    }
    snapshots.push({
      id: typeof value.id === "number" ? value.id : index,
      projectId: value.projectId,
      diff: value.diff,
    });
  });
  return { snapshots, invalidSnapshots };
}
