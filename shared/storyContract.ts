import { z } from "zod";

import { STORY_SHOT_EDITABLE_FIELDS } from "./shotDirector";
import { normalizeShotIdentity } from "./shotIdentity";

const editableStoryShotFields = new Set<string>(STORY_SHOT_EDITABLE_FIELDS);
const extensibleRecordSchema = z.object({}).catchall(z.unknown());

export const MIN_STORY_SHOT_DURATION_MS = 100;
export const MAX_STORY_SHOT_DURATION_MS = 12_000;

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

const promptOverrideSchema = z
  .object({
    value: z.string().max(6000).optional(),
    weight: z.number().finite().optional(),
  })
  .strict()
  .refine(
    value => value.value !== undefined || value.weight !== undefined,
    "提示词覆盖至少包含内容或权重"
  );

const promptRunSchema = z
  .object({
    finalPrompt: z.string().min(1).max(50_000),
    generatedAt: z.number().int().nonnegative(),
    imageId: z.number().int().positive().optional(),
    imageUrl: z.string().min(1).max(2_000_000).optional(),
    source: z.enum([
      "draw-this-moment",
      "prompt-table-rerender",
      "creation-agent",
    ]),
    usedDimensions: z.array(z.string().trim().min(1).max(120)).max(100),
    references: z
      .array(
        z
          .object({
            kind: z.enum(["baseImage", "characterRef", "styleRef"]),
            label: z.string().min(1).max(240),
            url: z.string().min(1).max(2_000_000).optional(),
          })
          .strict()
      )
      .max(20)
      .optional(),
  })
  .strict();

export const storyShotMetadataPatchSchema = z
  .object({
    durationMs: z
      .number()
      .int()
      .min(MIN_STORY_SHOT_DURATION_MS)
      .max(MAX_STORY_SHOT_DURATION_MS)
      .optional(),
    promptOverride: z
      .object({
        dimension: z.string().trim().min(1).max(120),
        override: promptOverrideSchema,
      })
      .strict()
      .optional(),
    promptRun: promptRunSchema.optional(),
  })
  .strict()
  .refine(value => Object.values(value).some(item => item !== undefined), {
    message: "至少修改一个镜头编辑元数据字段",
  });

export const storyShotUpdateCommandSchema = z
  .object({
    storyId: persistedStoryIdSchema,
    stableShotId: stableShotIdSchema,
    patch: storyShotFieldPatchSchema.optional(),
    metadata: storyShotMetadataPatchSchema.optional(),
  })
  .strict()
  .refine(value => value.patch !== undefined || value.metadata !== undefined, {
    message: "镜头命令不能为空",
  });

export type StoryShotUpdateCommand = z.infer<
  typeof storyShotUpdateCommandSchema
>;
export type StoryShotCommandUpdate = Pick<
  StoryShotUpdateCommand,
  "patch" | "metadata"
>;

/**
 * 职责：把已校验的字符串字段和编辑元数据原子合并到一条镜头快照。
 * 调用方：Story Agent 的 `updateStoryShotFields` 命令。
 * 下游：无；返回新镜头对象，调用方负责 revision CAS 落库。
 */
export function applyStoryShotUpdate(
  shot: Record<string, unknown>,
  command: StoryShotCommandUpdate
): Record<string, unknown> {
  const next = { ...shot, ...command.patch };
  const metadata = command.metadata;
  if (!metadata) return next;

  if (metadata.durationMs !== undefined) {
    next.durationMs = metadata.durationMs;
  }
  if (metadata.promptRun !== undefined) {
    next.promptRun = metadata.promptRun;
  }
  if (metadata.promptOverride !== undefined) {
    const existingOverrides =
      shot.promptOverrides &&
      typeof shot.promptOverrides === "object" &&
      !Array.isArray(shot.promptOverrides)
        ? (shot.promptOverrides as Record<string, unknown>)
        : {};
    const dimension = metadata.promptOverride.dimension;
    const existingDimension =
      existingOverrides[dimension] &&
      typeof existingOverrides[dimension] === "object" &&
      !Array.isArray(existingOverrides[dimension])
        ? (existingOverrides[dimension] as Record<string, unknown>)
        : {};
    next.promptOverrides = {
      ...existingOverrides,
      [dimension]: {
        ...existingDimension,
        ...metadata.promptOverride.override,
      },
    };
  }
  return next;
}

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
