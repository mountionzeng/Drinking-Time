import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as images from "./accountImages";
import * as stories from "./stories";
import { listMemorySpace, listMemorySpaceContacts } from "./memorySpace";
import { memoryState, resetMemoryStateForTesting } from "./runtime";
import { seedStoryForTesting } from "./testing";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  resetMemoryStateForTesting();
  seedStoryForTesting({ id: 1, userId: 10 });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("resolves accepted contacts without loading story-list covers or images", async () => {
  memoryState.storyContextShares.push({
    tokenHash: "accepted", userId: 10, storyId: 1,
    createdAt: new Date(), revokedAt: null, snapshot: {},
  } as (typeof memoryState.storyContextShares)[number]);
  memoryState.storyContextShareImports.push({ tokenHash: "accepted", userId: 20, storyId: 2 });
  const storyList = vi.spyOn(stories, "listUserStories");
  const covers = vi.spyOn(images, "latestStoryImageUrls");
  expect(await listMemorySpaceContacts(10)).toEqual([
    { userId: 20, displayName: "朋友", storyIds: [1] },
  ]);
  expect(storyList).not.toHaveBeenCalled();
  expect(covers).not.toHaveBeenCalled();
});

it("keeps explicit covers, latest-image fallback and empty covers on the bookshelf", async () => {
  seedStoryForTesting({ id: 2, userId: 10 });
  seedStoryForTesting({ id: 3, userId: 10 });
  const rows = await stories.listUserStories(10);
  vi.spyOn(stories, "listUserStories").mockResolvedValue(rows.map(row => ({
    ...row, coverImageUrl: row.id === 1 ? "explicit" : null,
  })));
  vi.spyOn(images, "latestStoryImageUrls").mockResolvedValue(new Map([[1, "unused"], [2, "fallback"]]));
  const result = await listMemorySpace(10);
  expect(Object.fromEntries(result.books.map(book => [book.id, book.coverUrl])))
    .toEqual({ 1: "explicit", 2: "fallback", 3: null });
});
