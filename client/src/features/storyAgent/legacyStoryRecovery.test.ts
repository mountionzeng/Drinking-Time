import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emptyState,
  findOrphanStory,
  loadState,
  storageKey,
} from "./storyAgentPersistence";
import {
  importLegacyStoryDraft,
  listLegacyStoryDrafts,
} from "./legacyStoryRecovery";
import { storySpineStore } from "./spine/storySpine";

function memoryStorage() {
  const data = new Map<string, string>();
  const storage = {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  vi.stubGlobal("localStorage", storage);
  return storage;
}
const draft = (title: string) => ({
  ...emptyState(),
  title,
  messages: [
    { id: "u", role: "user", content: "private draft", timestamp: 1 },
    { id: "a", role: "assistant", content: "reply", timestamp: 2 },
  ],
  savedAt: 10,
});
afterEach(() => {
  vi.unstubAllGlobals();
  storySpineStore.getState().resetStorySpine();
});

describe("account-scoped story recovery", () => {
  it("keeps a single user message recoverable before the first reply", () => {
    const storage = memoryStorage();
    storage.setItem(
      "dt:storyAgent:3",
      JSON.stringify({
        ...draft("single"),
        messages: [draft("single").messages[0]],
      })
    );
    expect(listLegacyStoryDrafts(storage)).toHaveLength(1);
    importLegacyStoryDraft({
      storage,
      sourceKey: "dt:storyAgent:3",
      userId: 1,
      projectId: 3,
      confirmed: true,
    });
    expect(loadState(3, 1).messages).toHaveLength(1);
  });
  it("rolls back a copy if claiming fails, preserving the original", () => {
    const storage = memoryStorage();
    const raw = JSON.stringify(draft("legacy"));
    storage.setItem("dt:storyAgent:3", raw);
    const setItem = storage.setItem;
    storage.setItem = (key, value) => {
      if (key.startsWith("dt:storyAgent:claimed:")) throw new Error("quota");
      setItem(key, value);
    };
    expect(() =>
      importLegacyStoryDraft({
        storage,
        sourceKey: "dt:storyAgent:3",
        userId: 1,
        projectId: 3,
        confirmed: true,
      })
    ).toThrow("quota");
    expect(storage.getItem(storageKey(3, 1)!)).toBeNull();
    expect(storage.getItem("dt:storyAgent:3")).toBe(raw);
  });
  it("keeps separate publishing draft versions when copying", () => {
    const storage = memoryStorage();
    const buffer = {
      storyId: 99,
      platform: "xiaohongshu",
      content: { title: "test", body: "one", tags: [] },
      updatedAt: 1,
    };
    storage.setItem(
      "dt:storyAgent:3",
      JSON.stringify({
        ...draft("versions"),
        publishingBuffers: {
          first: { ...buffer, versionId: "v1" },
          second: {
            ...buffer,
            versionId: "v2",
            content: { ...buffer.content, body: "two" },
          },
        },
      })
    );
    const restored = importLegacyStoryDraft({
      storage,
      sourceKey: "dt:storyAgent:3",
      userId: 1,
      projectId: 3,
      confirmed: true,
    });
    expect(
      Object.values(restored.publishingBuffers ?? {}).map(
        buffer => buffer.content.body
      )
    ).toEqual(["one", "two"]);
  });
  it("never hydrates legacy or another account's draft, even with the same project id", () => {
    const storage = memoryStorage();
    storage.setItem("dt:storyAgent:3", JSON.stringify(draft("legacy")));
    storage.setItem(storageKey(3, 1)!, JSON.stringify(draft("account one")));
    storage.setItem(storageKey(4, 10)!, JSON.stringify(draft("account ten")));
    expect(loadState(3, 2).messages).toEqual([]);
    expect(findOrphanStory(3, 2)).toBeNull();
    expect(loadState(3, 1).title).toBe("account one");
    expect(storageKey(3, null)).toBeNull();
    expect(findOrphanStory(3, null)).toBeNull();
  });
  it("retains automatic recovery within the same account", () => {
    const storage = memoryStorage();
    storage.setItem(
      storageKey(8, 1)!,
      JSON.stringify(draft("own stranded draft"))
    );
    expect(findOrphanStory(3, 1)?.title).toBe("own stranded draft");
  });
  it("offers only unclaimed legacy slots and requires explicit confirmation", () => {
    const storage = memoryStorage();
    const raw = JSON.stringify(draft("legacy"));
    storage.setItem("dt:storyAgent:3", raw);
    storage.setItem(storageKey(4, 2)!, JSON.stringify(draft("other account")));
    expect(listLegacyStoryDrafts(storage)).toEqual([
      { key: "dt:storyAgent:3", savedAt: 10 },
    ]);
    expect(() =>
      importLegacyStoryDraft({
        storage,
        sourceKey: "dt:storyAgent:3",
        userId: 1,
        projectId: 3,
        confirmed: false,
      })
    ).toThrow();
    expect(storage.getItem(storageKey(3, 1)!)).toBeNull();
    expect(storage.getItem("dt:storyAgent:3")).toBe(raw);
  });
  it("copies confirmed content as a new story without moving the source or reusing server ownership", () => {
    const storage = memoryStorage();
    const raw = JSON.stringify({
      ...draft("legacy"),
      remoteStoryId: 99,
      serverRevision: 9,
      activeStoryId: 99,
    });
    storage.setItem("dt:storyAgent:3", raw);
    importLegacyStoryDraft({
      storage,
      sourceKey: "dt:storyAgent:3",
      userId: 1,
      projectId: 3,
      confirmed: true,
    });
    expect(loadState(3, 1)).toMatchObject({
      title: "legacy",
      activeStoryId: -1,
      serverRevision: 0,
    });
    expect(loadState(3, 1).remoteStoryId).toBeUndefined();
    expect(storage.getItem("dt:storyAgent:3")).toBe(raw);
    expect(listLegacyStoryDrafts(storage)).toEqual([]);
    expect(loadState(3, 2).messages).toEqual([]);
    expect(() =>
      importLegacyStoryDraft({
        storage,
        sourceKey: storageKey(3, 1)!,
        userId: 2,
        projectId: 3,
        confirmed: true,
      })
    ).toThrow();
  });
  it("never overwrites existing work to import a legacy draft", () => {
    const storage = memoryStorage();
    const existing = JSON.stringify(draft("current work"));
    storage.setItem(storageKey(3, 1)!, existing);
    storage.setItem("dt:storyAgent:3", JSON.stringify(draft("legacy")));
    expect(() =>
      importLegacyStoryDraft({
        storage,
        sourceKey: "dt:storyAgent:3",
        userId: 1,
        projectId: 3,
        confirmed: true,
      })
    ).toThrow("请先保存");
    expect(storage.getItem(storageKey(3, 1)!)).toBe(existing);
  });
  it("drops in-memory content and invalidates outstanding loads when switching accounts", () => {
    const store = storySpineStore.getState();
    store.bindAccountScope(1);
    store.setMessages(draft("one").messages as never);
    store.setHydratedFor(3);
    const previous = storySpineStore.getState();
    const pendingLoad = previous.beginStoryLoad();
    previous.bindAccountScope(2);
    const next = storySpineStore.getState();
    expect(next.messages).toEqual([]);
    expect(next.hydratedFor).toBeNull();
    expect(next.accountId).toBe(2);
    expect(next.storyScopeEpoch).toBeGreaterThan(previous.storyScopeEpoch);
    expect(next.storyLoadEpoch).toBeGreaterThan(pendingLoad);
    next.bindAccountScope(2);
    expect(storySpineStore.getState().storyLoadEpoch).toBe(next.storyLoadEpoch);
  });
});
