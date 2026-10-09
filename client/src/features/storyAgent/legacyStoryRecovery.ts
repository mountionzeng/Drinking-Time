import {
  hasStoryWork,
  normalizePersisted,
  publishingBufferKey,
  storageKey,
  type PersistedState,
} from "./storyAgentPersistence";

type Storage = Pick<
  globalThis.Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>;
const legacyKey = /^dt:storyAgent:\d+$/;
const claimKey = (key: string) => `dt:storyAgent:claimed:${key}`;

/** Only unowned legacy slots are offered. Never offer another account's scoped drafts. */
export function listLegacyStoryDrafts(storage: Storage) {
  const drafts: Array<{ key: string; savedAt: number }> = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !legacyKey.test(key) || storage.getItem(claimKey(key)))
      continue;
    try {
      const state = normalizePersisted(
        JSON.parse(storage.getItem(key) ?? "null")
      );
      if (hasStoryWork(state))
        drafts.push({ key, savedAt: state.savedAt ?? 0 });
    } catch {
      /* Keep unreadable originals untouched. */
    }
  }
  return drafts.sort((a, b) => b.savedAt - a.savedAt);
}

/** Called only after the user explicitly confirms ownership. Copies; never deletes the original. */
export function importLegacyStoryDraft(input: {
  storage: Storage;
  sourceKey: string;
  userId: number;
  projectId: number;
  confirmed: boolean;
}) {
  const { storage, sourceKey, userId, projectId } = input;
  const target = storageKey(projectId, userId);
  if (
    !input.confirmed ||
    !target ||
    !legacyKey.test(sourceKey) ||
    storage.getItem(claimKey(sourceKey))
  ) {
    throw new Error("无法导入这份旧草稿");
  }
  const previousRaw = storage.getItem(target);
  const previous = normalizePersisted(JSON.parse(previousRaw ?? "{}"));
  if (hasStoryWork(previous)) {
    throw new Error("请先保存当前内容并打开一个空白新故事，再导入旧草稿");
  }
  const original = normalizePersisted(
    JSON.parse(storage.getItem(sourceKey) ?? "{}")
  );
  if (!hasStoryWork(original)) throw new Error("旧草稿为空或无法读取");
  // Old server ids/revisions cannot grant ownership or overwrite an existing cloud story.
  const restored: PersistedState = {
    ...original,
    remoteStoryId: undefined,
    activeStoryId: -1,
    serverRevision: 0,
    publishingBuffers: Object.fromEntries(
      Object.values(original.publishingBuffers ?? {}).map(buffer => [
        publishingBufferKey(-1, buffer.platform, buffer.versionId),
        { ...buffer, storyId: -1 },
      ])
    ),
    savedAt: Date.now(),
  };
  storage.setItem(target, JSON.stringify(restored));
  try {
    storage.setItem(claimKey(sourceKey), String(userId));
  } catch (error) {
    // Do not report a failed import while leaving an automatically restorable copy.
    if (previousRaw === null) storage.removeItem(target);
    else storage.setItem(target, previousRaw);
    throw error;
  }
  return restored;
}
