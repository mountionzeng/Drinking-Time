/** Persistence operations for testing. Local and MySQL behavior share this boundary. */
import {
  StorySoundWorkspaceRecord,
  StorySoundPlanVersionRecord,
  StorySoundRowOperationRecord,
  StoryVoiceProfileRecord,
  StoryVoiceActivationOperationRecord,
} from "../../drizzle/schema";
import {
  MemoryState,
  memoryState,
  nextIdFromRows,
  now,
  toDate,
} from "./runtime";
import { emptyBody } from "./storyValues";

/**
 * Reset in-memory state and loaded flag — for use in tests only.
 * Prevents accumulated state from prior test runs from leaking between tests.
 */
/**
 * 用途：测试专用——按指定 id 直接种一行归属明确的 project。项目级归属校验落地后，
 *   拿一个凭空的 projectId 调接口会被正确拒绝，而不少既有测试正是这么写的（断言
 *   里还钉着那个字面量 id）。与其改掉这些断言，不如让测试先把这行数据真正建出来，
 *   保持"接口只接受属于自己的 project"这条不变量在测试里也成立。
 * 调用入口：server/*.test.ts（仅测试）。
 * 下游调用：无，直接写 memoryState.projects。
 */
export function seedProjectForTesting(input: {
  id: number;
  userId: number;
  name?: string;
}): void {
  const current = now();
  memoryState.projects = memoryState.projects.filter(
    project => project.id !== input.id
  );
  memoryState.projects.push({
    id: input.id,
    userId: input.userId,
    name: input.name ?? `测试项目 ${input.id}`,
    deadline: null,
    autoRender: false,
    createdAt: current,
    updatedAt: current,
  });
}

export function seedStoryForTesting(input: {
  id: number;
  userId: number;
  title?: string;
}): void {
  const current = now();
  memoryState.stories = memoryState.stories.filter(
    story => story.id !== input.id
  );
  memoryState.stories.push({
    id: input.id,
    userId: input.userId,
    projectId: null,
    title: input.title ?? `测试故事 ${input.id}`,
    logline: null,
    theme: null,
    arc: null,
    summary: null,
    body: emptyBody(),
    createdAt: current,
    updatedAt: current,
  });
  memoryState.nextIds.story = Math.max(memoryState.nextIds.story, input.id + 1);
}

/** Test-only round-trip through the same JSON representation used by local-persist. */
export function serializeStorySoundDirectorStateForTesting(): string {
  return JSON.stringify({
    storySoundWorkspaces: memoryState.storySoundWorkspaces,
    storySoundPlanVersions: memoryState.storySoundPlanVersions,
    storySoundRowOperations: memoryState.storySoundRowOperations,
    storyVoiceProfiles: memoryState.storyVoiceProfiles,
    storyVoiceActivationOperations: memoryState.storyVoiceActivationOperations,
    nextIds: {
      storySoundWorkspace: memoryState.nextIds.storySoundWorkspace,
      storySoundPlanVersion: memoryState.nextIds.storySoundPlanVersion,
      storySoundRowOperation: memoryState.nextIds.storySoundRowOperation,
      storyVoiceProfile: memoryState.nextIds.storyVoiceProfile,
      storyVoiceActivationOperation:
        memoryState.nextIds.storyVoiceActivationOperation,
    },
  });
}

export function restoreStorySoundDirectorStateForTesting(
  payload: string
): void {
  const raw = JSON.parse(payload) as Partial<MemoryState>;
  memoryState.storySoundWorkspaces = (raw.storySoundWorkspaces ?? []).map(
    row => ({
      ...row,
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt),
    })
  ) as StorySoundWorkspaceRecord[];
  memoryState.storySoundPlanVersions = (raw.storySoundPlanVersions ?? []).map(
    row => ({ ...row, createdAt: toDate(row.createdAt) })
  ) as StorySoundPlanVersionRecord[];
  memoryState.storySoundRowOperations = (raw.storySoundRowOperations ?? []).map(
    row => ({
      ...row,
      tombstonedAt: row.tombstonedAt ? toDate(row.tombstonedAt) : null,
      createdAt: toDate(row.createdAt),
      updatedAt: toDate(row.updatedAt),
    })
  ) as StorySoundRowOperationRecord[];
  memoryState.storyVoiceProfiles = (raw.storyVoiceProfiles ?? []).map(row => ({
    ...row,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  })) as StoryVoiceProfileRecord[];
  memoryState.storyVoiceActivationOperations = (
    raw.storyVoiceActivationOperations ?? []
  ).map(row => ({
    ...row,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  })) as StoryVoiceActivationOperationRecord[];
  memoryState.nextIds.storySoundWorkspace = Math.max(
    raw.nextIds?.storySoundWorkspace ?? 0,
    nextIdFromRows(memoryState.storySoundWorkspaces)
  );
  memoryState.nextIds.storySoundPlanVersion = Math.max(
    raw.nextIds?.storySoundPlanVersion ?? 0,
    nextIdFromRows(memoryState.storySoundPlanVersions)
  );
  memoryState.nextIds.storySoundRowOperation = Math.max(
    raw.nextIds?.storySoundRowOperation ?? 0,
    nextIdFromRows(memoryState.storySoundRowOperations)
  );
  memoryState.nextIds.storyVoiceProfile = Math.max(
    raw.nextIds?.storyVoiceProfile ?? 0,
    nextIdFromRows(memoryState.storyVoiceProfiles)
  );
  memoryState.nextIds.storyVoiceActivationOperation = Math.max(
    raw.nextIds?.storyVoiceActivationOperation ?? 0,
    nextIdFromRows(memoryState.storyVoiceActivationOperations)
  );
}
