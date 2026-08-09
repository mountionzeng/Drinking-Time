import { z } from "zod";

import { STORY_SHOT_EDITABLE_FIELDS } from "./shotDirector";
import { normalizeShotIdentity } from "./shotIdentity";

const editableStoryShotFields = new Set<string>(STORY_SHOT_EDITABLE_FIELDS);
const extensibleRecordSchema = z.object({}).catchall(z.unknown());

/** 已落库的故事必须使用正整数；草稿身份不能再伪装成 -1。 */
export const persistedStoryIdSchema = z.number().int().positive();

/** 镜头身份在进入服务端前统一规范化，后续匹配不再重复猜格式。 */
export const stableShotIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(96)
  .transform(value => normalizeShotIdentity(value))
  .pipe(z.string().min(1).max(96));

/** 持久化镜头的最小契约；未知业务字段原样保留，便于渐进迁移。 */
export const persistedStoryShotSchema = z
  .object({
    stableShotId: stableShotIdSchema,
    shotIdentity: stableShotIdSchema,
    shotNo: z.number().int().positive().optional(),
  })
  .catchall(z.unknown());

/** Story body 的第一层契约；先锁住版本、集合形状和镜头身份。 */
export const persistedStoryBodySchema = z
  .object({
    _revision: z.number().int().nonnegative(),
    cards: z.array(extensibleRecordSchema).optional(),
    messages: z.array(extensibleRecordSchema).optional(),
    shots: z.array(persistedStoryShotSchema).optional(),
  })
  .catchall(z.unknown());

/** 镜头字段命令只允许修改显式白名单，禁止顺手覆盖身份或整条镜头。 */
export const storyShotFieldPatchSchema = z
  .record(z.string(), z.string().max(6000))
  .refine(value => Object.keys(value).length > 0, "至少修改一个镜头字段")
  .refine(
    value =>
      Object.keys(value).every(field => editableStoryShotFields.has(field)),
    "包含不支持修改的镜头字段"
  );

/**
 * 职责：校验准备落库的 Story body，并保留尚未纳入契约的扩展字段。
 * 调用方：Story 契约测试，以及需要验证完整迁移结果的诊断脚本。
 * 下游：调用 `persistedStoryBodySchema.parse`；校验失败时阻止损坏数据落库。
 */
export function parsePersistedStoryBody(
  value: unknown
): z.infer<typeof persistedStoryBodySchema> {
  return persistedStoryBodySchema.parse(value);
}

/**
 * 职责：在 Story 写入热路径只检查顶层持久化不变量，不复制大型集合。
 * 调用方：`prepareStoryBody` 在完成镜头清洗和身份补齐后调用。
 * 下游：无；发现非法 revision 或集合形状时立即抛错，阻止损坏数据落库。
 */
export function assertPersistedStoryBodyEnvelope(
  value: Record<string, unknown>
): void {
  if (!Number.isInteger(value._revision) || (value._revision as number) < 0) {
    throw new TypeError("Story body revision 必须是非负整数");
  }
  for (const field of ["cards", "messages", "shots"] as const) {
    if (value[field] !== undefined && !Array.isArray(value[field])) {
      throw new TypeError(`Story body ${field} 必须是数组`);
    }
  }
}
