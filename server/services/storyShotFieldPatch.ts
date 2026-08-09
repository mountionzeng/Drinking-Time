/**
 * 把一组字段改动落到某个镜头上——`stories.body` 里镜头字段的唯一写入口。
 *
 * ## 为什么要抽出来
 *
 * 原本这段逻辑长在 `storyAgent.updateStoryShotFields` 这一个 procedure 里。确认
 * 提示词候选时也需要把确认值写回镜头表（否则「确认」只改谱系、不改 body，而故事版
 * 出图读的正是 body——表现为确认了却什么都没发生），如果在 promptLineage router 里
 * 再抄一份，两份的乐观并发校验、故事版字段版本记录迟早会走岔。
 *
 * 这里刻意**不做**两件事，留给调用方决定：
 *   1. 不触发 `migrateStoryPromptLineage`（body → 谱系方向的同步）——候选回写本身
 *      就是从谱系来的，再同步回去是多余的一圈。
 *   2. 不调 `composeStoryWorkspace` 组装前端视图——那是 router 的职责，服务层
 *      依赖 router 会把依赖方向颠倒过来。
 */
import { getStoryById } from "../db";
import { shotIdentityFromShot } from "../../shared/shotIdentity";
import {
  initializeStoryboardFieldVersions,
  recordStoryboardFieldVersions,
  STORYBOARD_VERSIONED_FIELDS,
} from "../../shared/storyboardFieldVersions";
import { getStoryRevision, prepareStoryBody } from "./storySync";
import {
  applyStoryShotUpdate,
  type StoryShotCommandUpdate,
} from "../../shared/storyContract";
import {
  persistPreparedStoryBody,
  StoryBodyRevisionConflictError,
  type PersistedStory,
} from "./storyBodyPersistence";

export type StoryShotFieldPatchResult =
  | { status: "ok"; story: PersistedStory }
  | { status: "error"; error: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function onlyShotRecords(shots: readonly unknown[]): Record<string, unknown>[] {
  return shots.filter((shot): shot is Record<string, unknown> =>
    Boolean(asRecord(shot)),
  );
}

export async function applyStoryShotFieldPatch(input: {
  storyId: number;
  userId: number;
  stableShotId: string;
  patch?: Record<string, string>;
  metadata?: StoryShotCommandUpdate["metadata"];
}): Promise<StoryShotFieldPatchResult> {
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) {
    return { status: "error", error: "故事不存在" };
  }
  const body = asRecord(story.body) ?? {};
  const shots = Array.isArray(body.shots) ? body.shots : [];
  let found = false;
  const nextShots = shots.map((raw, index) => {
    const shot = asRecord(raw);
    if (!shot) return raw;
    if (shotIdentityFromShot(shot, index) !== input.stableShotId) return raw;
    found = true;
    return applyStoryShotUpdate(shot, {
      patch: input.patch ?? {},
      metadata: input.metadata,
    });
  });
  if (!found) {
    return { status: "error", error: "镜头不存在或已经更新" };
  }

  const versionedFields = STORYBOARD_VERSIONED_FIELDS.filter(
    field =>
      Object.prototype.hasOwnProperty.call(input.patch ?? {}, field) ||
      (field === "dialogue" &&
        Object.prototype.hasOwnProperty.call(input.patch ?? {}, "sound")),
  );
  const now = Date.now();
  const initializedFieldVersions = initializeStoryboardFieldVersions(
    body.storyboardFieldVersions,
    onlyShotRecords(shots),
    now,
    "edited",
  );
  const storyboardFieldVersions =
    versionedFields.length > 0
      ? recordStoryboardFieldVersions({
          state: initializedFieldVersions,
          beforeShots: onlyShotRecords(shots),
          afterShots: onlyShotRecords(nextShots),
          fields: versionedFields,
          now,
          source: "edited",
        })
      : body.storyboardFieldVersions;

  const nextBody = prepareStoryBody(
    {
      ...body,
      shots: nextShots,
      ...(versionedFields.length > 0 ? { storyboardFieldVersions } : {}),
    },
    getStoryRevision(story.body) + 1,
    story.body,
  );

  try {
    return {
      status: "ok",
      story: await persistPreparedStoryBody({
        storyId: story.id,
        userId: input.userId,
        expectedRevision: getStoryRevision(story.body),
        body: nextBody,
      }),
    };
  } catch (error) {
    if (error instanceof StoryBodyRevisionConflictError) {
      return { status: "error", error: "镜头已在别处更新，请刷新后重试" };
    }
    throw error;
  }
}
