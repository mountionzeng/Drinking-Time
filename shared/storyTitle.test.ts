import { describe, expect, it } from "vitest";
import {
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
    ).toBe("这个标题实在太长了需要在列表里面被安");
  });

  it("derives a useful fallback from the first meaningful user sentence", () => {
    expect(
      fallbackStoryTitleFromText("我想讲一下，凌晨三点整理旧书时突然停电了。")
    ).toBe("凌晨三点整理旧书时突然停电了");
    expect(fallbackStoryTitleFromText("你好")).toBeNull();
  });

  it("auto names only unnamed stories and never overwrites a manual title", () => {
    expect(resolveAutoStoryTitle("未命名故事", "雨夜里的旧书")).toBe(
      "雨夜里的旧书"
    );
    expect(resolveAutoStoryTitle("我的标题", "雨夜里的旧书")).toBeUndefined();
    expect(resolveAutoStoryTitle(undefined, "未命名故事")).toBeUndefined();
  });
});
