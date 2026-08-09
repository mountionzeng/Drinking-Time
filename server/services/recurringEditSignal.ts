/**
 * 重复修正信号 —— 把「用户在这个项目里反复改同一个镜头的同一个维度」
 * 从编辑快照历史里提炼出来，喂给 Story Agent 的系统提示词。
 *
 * 背景：`semanticAnnotation.ts` 推断的「创作偏好」是自由文本句子
 * （如"倾向于克制的情感表达风格"），既不绑定 storyId/stableShotId，也不绑定
 * 具体维度，没法直接变成提示词谱系里的候选修订（`createPromptCandidateForStory`
 * 需要 nodeId + 具体 content）。这个模块走另一条路：不猜"用户想要什么"，
 * 只如实报告"用户在哪个镜头的哪个维度上来回改了不止一次"——这是确定性事实，
 * 不需要 LLM 推断，也不会推断错。
 *
 * 怎么用这个信号：不是自动生成候选修订（那需要替换文本，属于生成任务，
 * 这里没有做），而是注入 Story Agent 的对话上下文，让小酌能主动问一句
 * "这个镜头的光线你已经调了三次，要不要把这个方向定下来？"——
 * 走的是已有的"agent 提议、用户在对话里确认"路径（R8/R9），不是新建一套
 * UI 去展示/确认一个自动生成的候选。
 */
import type { EditSnapshot } from "../../drizzle/schema";
import {
  dimensionForField,
  isPromptDimensionField,
} from "../../shared/promptFieldDimensions";
import { getRecentEditSnapshots } from "../db";

/** 达到这个次数才算「反复修正」，不是随手改一次 */
export const RECURRING_EDIT_THRESHOLD = 2;

/**
 * 一次 diff pair 里同时变化的提示词维度数，超过这个数就不算「用户在改这一处」，
 * 算「整个镜头被重写/重新生成了」——两者要分开计数，否则「小酌帮你重新生成了
 * 7 次镜头」会被误读成「用户反复纠结这一个维度」，把噪音当成了信号。
 *
 * 校准依据：真实语料里单次变化的维度数分布明显双峰——1-2 个维度同时变的只占
 * 4/96 次，中位数是 9（整镜重写）。阈值定在 3，刚好卡在两簇中间。
 */
export const TARGETED_EDIT_FIELD_LIMIT = 3;

export type RecurringEditSignal = {
  stableShotId: string;
  dimension: string;
  editCount: number;
  /** 最近一次修正前后的值，帮 agent 判断变化方向 */
  latestOld: string;
  latestNew: string;
  /** 最早一次记录到这个改动的时间 */
  firstEditedAt: string;
  latestEditedAt: string;
};

type ShotRecord = Record<string, unknown> & { stableShotId?: unknown };
type ModifiedPair = { old: ShotRecord | null; new: ShotRecord | null };

function fieldValueKey(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  return JSON.stringify(value);
}

function extractModifiedPairs(diff: unknown): ModifiedPair[] {
  if (!diff || typeof diff !== "object") return [];
  const shots = (diff as { shots?: unknown }).shots;
  if (!shots || typeof shots !== "object") return [];
  const modified = (shots as { modified?: unknown }).modified;
  return Array.isArray(modified) ? (modified as ModifiedPair[]) : [];
}

/**
 * 从一段快照历史（按时间正序）里算出每个 (镜头, 维度) 的修正次数。
 * 纯函数——不碰数据库，方便单测直接喂构造数据。
 */
export function computeRecurringEditSignals(
  snapshots: readonly Pick<EditSnapshot, "diff" | "timestamp">[],
  threshold = RECURRING_EDIT_THRESHOLD,
  targetedFieldLimit = TARGETED_EDIT_FIELD_LIMIT,
): RecurringEditSignal[] {
  type Accumulator = {
    stableShotId: string;
    dimension: string;
    count: number;
    latestOld: string;
    latestNew: string;
    firstEditedAt: Date;
    latestEditedAt: Date;
  };
  const byKey = new Map<string, Accumulator>();

  // 时间正序遍历，这样「latest」自然就是遍历到的最后一次赋值
  const ordered = [...snapshots].sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );

  for (const snapshot of ordered) {
    for (const pair of extractModifiedPairs(snapshot.diff)) {
      const stableShotId = pair.old?.stableShotId ?? pair.new?.stableShotId;
      if (typeof stableShotId !== "string" || !stableShotId) continue;

      const fields = new Set([
        ...Object.keys(pair.old ?? {}),
        ...Object.keys(pair.new ?? {}),
      ]);
      const changedDimensionFields: string[] = [];
      fields.forEach(field => {
        if (!isPromptDimensionField(field)) return;
        const oldValue = fieldValueKey(pair.old?.[field]);
        const newValue = fieldValueKey(pair.new?.[field]);
        if (oldValue !== newValue) changedDimensionFields.push(field);
      });

      // 一次改了很多维度＝整个镜头被重写/重新生成了，不是「用户在改这一处」——
      // 这种事件不计入任何维度的「反复修正」次数（否则重新生成 7 次会被误读成
      // 用户对 7 个维度都很纠结，见 TARGETED_EDIT_FIELD_LIMIT 的注释）。
      if (
        changedDimensionFields.length === 0 ||
        changedDimensionFields.length > targetedFieldLimit
      ) {
        continue;
      }

      for (const field of changedDimensionFields) {
        const oldValue = fieldValueKey(pair.old?.[field]);
        const newValue = fieldValueKey(pair.new?.[field]);
        const dimension = dimensionForField(field);
        const key = `${stableShotId}::${dimension}`;
        const existing = byKey.get(key);
        if (existing) {
          existing.count += 1;
          existing.latestOld = oldValue;
          existing.latestNew = newValue;
          existing.latestEditedAt = snapshot.timestamp;
        } else {
          byKey.set(key, {
            stableShotId,
            dimension,
            count: 1,
            latestOld: oldValue,
            latestNew: newValue,
            firstEditedAt: snapshot.timestamp,
            latestEditedAt: snapshot.timestamp,
          });
        }
      }
    }
  }

  return Array.from(byKey.values())
    .filter(item => item.count >= threshold)
    .sort(
      (left, right) =>
        right.count - left.count ||
        right.latestEditedAt.getTime() - left.latestEditedAt.getTime(),
    )
    .map(item => ({
      stableShotId: item.stableShotId,
      dimension: item.dimension,
      editCount: item.count,
      latestOld: item.latestOld,
      latestNew: item.latestNew,
      firstEditedAt: item.firstEditedAt.toISOString(),
      latestEditedAt: item.latestEditedAt.toISOString(),
    }));
}

/** 给 Story Agent 系统提示词用的人类可读block；没有信号时返回空字符串 */
export function formatRecurringEditSignalBlock(
  signals: readonly RecurringEditSignal[],
  maxItems = 5,
): string {
  if (signals.length === 0) return "";
  const lines = signals.slice(0, maxItems).map(signal => {
    const from = signal.latestOld ? `「${signal.latestOld}」` : "（空）";
    const to = signal.latestNew ? `「${signal.latestNew}」` : "（空）";
    return `- 镜头 ${signal.stableShotId} 的「${signal.dimension}」已改过 ${signal.editCount} 次，最近一次从 ${from} 改成 ${to}`;
  });
  return (
    `用户在本项目里反复修正过的维度（可以主动确认是否要定下这个方向，不要替用户直接改）：\n` +
    lines.join("\n")
  );
}

/** 拉某个项目最近的编辑历史，算出重复修正信号。失败时上层应静默降级。 */
export async function getRecurringEditSignalsForProject(
  projectId: number,
  limit = 50,
): Promise<RecurringEditSignal[]> {
  const snapshots = await getRecentEditSnapshots(projectId, limit);
  return computeRecurringEditSignals(snapshots);
}
