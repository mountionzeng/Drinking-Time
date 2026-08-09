/**
 * 维度 → 镜头表字段 的反向映射。
 *
 * ## 为什么需要
 *
 * 谱系里的维度是规范 snake_case id（`style_reference`），镜头表字段是 camelCase
 * （`styleRef`）。阶段 D「改镜头表 → 提候选」走的是正方向，由
 * {@link canonicalDimension} 完成；确认候选后「把确认值写回镜头表」走的是反方向，
 * 就是这张表。
 *
 * ## 为什么是派生而不是手写
 *
 * 反向表从 {@link STORY_SHOT_EDITABLE_FIELDS} 逐个跑 `canonicalDimension` 派生出来，
 * 不手写第二份清单。手写的话，新增一个可编辑字段时正向能用、反向漏登记，症状是
 * 「确认了候选但镜头表没变」——正是这套机制要解决的问题本身。
 *
 * 派生的代价是：只有**已登记进规范词表**的字段才会出现在反向表里。`colorPalette`、
 * `characterReference`、`sceneReference` 这些镜头字段目前没有登记成对应维度的别名，
 * 因此不可回写。这跟阶段 D 的行为是一致的（那边同样 `isKnownDimension` 不通过就跳过），
 * 两个方向要么一起支持要么一起不支持，不会出现单向可用的错位。
 */
import {
  STORY_SHOT_EDITABLE_FIELDS,
  type StoryShotEditableField,
} from "./shotDirector";
import { canonicalDimension, isKnownDimension } from "./promptDimensions";

const fieldByDimension = new Map<string, StoryShotEditableField>();

for (const field of STORY_SHOT_EDITABLE_FIELDS) {
  const dimension = canonicalDimension(field);
  if (!isKnownDimension(dimension)) continue;
  const existing = fieldByDimension.get(dimension);
  if (existing) {
    // 建表时就炸，不等运行到回写才发现：两个镜头字段抢同一个维度时，
    // 回写无从判断该写哪一列，静默挑一个只会产生难查的错值。
    throw new Error(
      `[promptShotFields] 维度 "${dimension}" 同时对应镜头字段 "${existing}" 和 "${field}"——回写时无法判断该写哪一列。`,
    );
  }
  fieldByDimension.set(dimension, field);
}

/**
 * 取维度对应的镜头表字段。返回 undefined 是正常情况而非错误：故事级共享维度
 * （`character_reference`、`art_style_recipe`…）在镜头表里没有一一对应的可编辑列。
 */
export function shotFieldForDimension(
  dimension: string,
): StoryShotEditableField | undefined {
  return fieldByDimension.get(canonicalDimension(dimension));
}

/** 可回写的维度全集（规范 id，已排序）。 */
export const WRITEBACK_DIMENSIONS: readonly string[] = Array.from(
  fieldByDimension.keys(),
).sort();
