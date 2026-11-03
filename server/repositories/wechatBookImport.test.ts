import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import * as runtime from "./runtime";
import { wechatImportedStoryIds } from "./wechatBookImport";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  runtime.resetMemoryStateForTesting();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("keeps account and revision boundaries, including receipts whose story no longer exists", async () => {
  const add = (userId: number, requestId: string, storyId: number) => runtime.memoryState.chapterImports.push({
    userId, requestId, storyId, chapterId: null, outcome: "imported",
    requestHash: "hash", createdAt: new Date(0),
  });
  add(10, "first-revision", 7);
  add(20, "first-revision", 8);
  add(10, "other-revision", 9);
  expect(await wechatImportedStoryIds(10, ["first-revision", "missing", "first-revision"]))
    .toEqual(new Map([["first-revision", 7]]));
  expect(runtime.memoryState.stories).toHaveLength(0);
});

it("does not access the database for an empty catalog", async () => {
  const getDb = vi.spyOn(runtime, "getDb");
  expect(await wechatImportedStoryIds(10, [])).toEqual(new Map());
  expect(getDb).not.toHaveBeenCalled();
});

it("uses one narrow SQL query constrained by owner and requested revisions", async () => {
  const where = vi.fn().mockResolvedValue([{ requestId: "one", storyId: 7 }]);
  const from = vi.fn(() => ({ where }));
  const select = vi.fn((_fields: Record<string, unknown>) => ({ from }));
  vi.spyOn(runtime, "getDb").mockResolvedValue({ select } as unknown as NonNullable<Awaited<ReturnType<typeof runtime.getDb>>>);
  expect(await wechatImportedStoryIds(10, ["one", "two"])).toEqual(new Map([["one", 7]]));
  expect(select).toHaveBeenCalledTimes(1);
  expect(Object.keys(select.mock.calls[0][0])).toEqual(["requestId", "storyId"]);
  expect(where).toHaveBeenCalledTimes(1);
  const query = new MySqlDialect().sqlToQuery(where.mock.calls[0][0]);
  expect(query.sql).toContain('`chapter_imports`.`userId` = ?');
  expect(query.sql).toContain('`chapter_imports`.`requestId` in (?, ?)');
  expect(query.params).toEqual([10, "one", "two"]);
});
