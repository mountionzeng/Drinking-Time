import { describe, expect, it } from "vitest";
import {
  RECENT_STORY_LIST_CACHE_WINDOW_MS,
  STORY_GET_MOUNT_STALE_WINDOW_MS,
  coldEntryStoryListFetchOptions,
} from "./recentStoryListCache";

describe("coldEntryStoryListFetchOptions", () => {
  it("returns a bounded, non-zero staleTime window", () => {
    const options = coldEntryStoryListFetchOptions();
    expect(options.staleTime).toBe(RECENT_STORY_LIST_CACHE_WINDOW_MS);
    expect(options.staleTime).toBeGreaterThan(0);
    // 只是「刚取回的一份别再打第二次」的窗口，不能变成长期缓存。
    expect(options.staleTime).toBeLessThanOrEqual(10_000);
  });
});

describe("STORY_GET_MOUNT_STALE_WINDOW_MS", () => {
  it("is a bounded, non-zero window", () => {
    expect(STORY_GET_MOUNT_STALE_WINDOW_MS).toBeGreaterThan(0);
    expect(STORY_GET_MOUNT_STALE_WINDOW_MS).toBeLessThanOrEqual(10_000);
  });
});
