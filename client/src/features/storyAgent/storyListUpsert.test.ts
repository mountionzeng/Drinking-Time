import { describe, expect, it } from "vitest";
import { upsertCreatedStoryListItem } from "./storyListUpsert";

describe("upsertCreatedStoryListItem", () => {
  it("prepends a newly created story", () => {
    const next = upsertCreatedStoryListItem([{ id: 1, title: "旧" }], { id: 9, title: " 新故事标题 " });
    expect(next.map(i => [i.id, i.title])).toEqual([[9, "新故事标题"], [1, "旧"]]);
  });
  it("does not duplicate or overwrite an existing titled item", () => {
    const items = [{ id: 9, title: "已有" }];
    expect(upsertCreatedStoryListItem(items, { id: 9, title: "别的" })).toBe(items);
  });
  it("fills a blank existing title and ignores non-persisted ids", () => {
    expect(upsertCreatedStoryListItem([{ id: 9, title: "" }], { id: 9, title: "补" })[0].title).toBe("补");
    const items = [{ id: 1, title: "a" }];
    expect(upsertCreatedStoryListItem(items, { id: -1, title: "x" })).toBe(items);
  });
});
