import { describe, expect, it } from "vitest";
import {
  resolveUpsertStoryTitle,
  fallbackStoryTitleFromText,
  isUntitledStoryTitle,
  normalizeSuggestedStoryTitle,
  resolveAutoStoryTitle,
} from "./storyTitle";

describe("story title helpers", () => {
  it("recognizes only the placeholder titles as unnamed", () => {
    expect(isUntitledStoryTitle(undefined)).toBe(true);
    expect(isUntitledStoryTitle("未命名")).toBe(true);
    expect(isUntitledStoryTitle("未命名故事")).toBe(true);
    expect(isUntitledStoryTitle("雨夜里的旧书")).toBe(false);
  });

  it("cleans model wrappers and keeps a short, readable title", () => {
    expect(normalizeSuggestedStoryTitle("标题：《雨夜里的旧书》。")).toBe(
      "雨夜里的旧书"
    );
    expect(
      normalizeSuggestedStoryTitle(
        "这个标题实在太长了需要在列表里面被安全地截断"
      )
    ).toBeNull();
    expect(
      normalizeSuggestedStoryTitle(`联系${["138", "0000", "0000"].join("")}`)
    ).toBeNull();
  });

  it("derives a useful fallback from the first meaningful user sentence", () => {
    expect(
      fallbackStoryTitleFromText("我想讲一下，凌晨三点整理旧书时突然停电了。")
    ).toBe("凌晨三点整理旧书时突然停电了");
    expect(fallbackStoryTitleFromText("你好")).toBeNull();
    expect(fallbackStoryTitleFromText("我想讲一件事。")).toBeNull();
  });

  it("auto names only unnamed stories and never overwrites a manual title", () => {
    expect(resolveAutoStoryTitle("未命名故事", "雨夜里的旧书")).toBe(
      "雨夜里的旧书"
    );
    expect(resolveAutoStoryTitle("我的标题", "雨夜里的旧书")).toBeUndefined();
    expect(resolveAutoStoryTitle(undefined, "未命名故事")).toBeUndefined();
  });
});

describe("resolveUpsertStoryTitle", () => {
  const base = { syncConflict: false };
  it("fills a placeholder title even when autosave preserves titles", () => {
    expect(resolveUpsertStoryTitle({ ...base, existingTitle: "未命名", inputTitle: "清晨在河边跑步", preserveTitle: true })).toBe("清晨在河边跑步");
    expect(resolveUpsertStoryTitle({ ...base, existingTitle: "", inputTitle: "海边", preserveTitle: true })).toBe("海边");
  });
  it("never overwrites a real title during autosave", () => {
    expect(resolveUpsertStoryTitle({ ...base, existingTitle: "我改过的名字", inputTitle: "自动标题", preserveTitle: true })).toBe("我改过的名字");
  });
  it("keeps existing title on conflict, missing or blank input", () => {
    expect(resolveUpsertStoryTitle({ existingTitle: "未命名", inputTitle: "新", preserveTitle: false, syncConflict: true })).toBe("未命名");
    expect(resolveUpsertStoryTitle({ ...base, existingTitle: "旧", inputTitle: undefined, preserveTitle: false })).toBe("旧");
    expect(resolveUpsertStoryTitle({ ...base, existingTitle: "旧", inputTitle: "  ", preserveTitle: false })).toBe("旧");
  });
  it("does not replace a placeholder with another placeholder", () => {
    expect(resolveUpsertStoryTitle({ ...base, existingTitle: "", inputTitle: "未命名", preserveTitle: true })).toBe("");
  });
  it("explicit saves still write the input title", () => {
    expect(resolveUpsertStoryTitle({ ...base, existingTitle: "旧", inputTitle: "新", preserveTitle: false })).toBe("新");
  });
});
