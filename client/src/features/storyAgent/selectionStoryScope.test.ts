import { describe, expect, it } from "vitest";
import {
  scopedSelection,
  selectionBelongsToStory,
} from "./selectionStoryScope";

function shotSelection(storyId: number | null) {
  return {
    sourceType: "shot" as const,
    sourceId: "3:subject",
    selectedText: "森林；静静显现为已经存在的庇护",
    fullText: "森林；静静显现为已经存在的庇护",
    storyId,
    stableShotId: "sh-0402",
    shotNo: 402,
  };
}

describe("selectionStoryScope", () => {
  it("hides a selection that belongs to another story", () => {
    // 实际现场：SheSelf 的 0402 选区挂在「Codex消耗特别大」的输入框上。
    const foreign = shotSelection(1186);
    expect(selectionBelongsToStory(foreign, 1204)).toBe(false);
    expect(scopedSelection(foreign, 1204)).toBeNull();
  });

  it("keeps a selection that belongs to the active story", () => {
    const own = shotSelection(1186);
    expect(selectionBelongsToStory(own, 1186)).toBe(true);
    expect(scopedSelection(own, 1186)).toBe(own);
  });

  it("keeps selections that carry no story id", () => {
    // 纯文本类选区不带 storyId，无法证伪；这些也不是会串台的那一类。
    const legacy = shotSelection(null);
    expect(selectionBelongsToStory(legacy, 1204)).toBe(true);
    expect(scopedSelection(legacy, 1204)).toBe(legacy);
  });

  it("drops a story-bound selection when no story is open", () => {
    // 回到故事列表时 activeStoryId 是 null，这时任何带 storyId 的选区都不该还挂着。
    expect(selectionBelongsToStory(shotSelection(1186), null)).toBe(false);
    expect(scopedSelection(shotSelection(1186), null)).toBeNull();
  });

  it("treats a missing selection as no selection", () => {
    expect(selectionBelongsToStory(null, 1186)).toBe(false);
    expect(selectionBelongsToStory(undefined, 1186)).toBe(false);
    expect(scopedSelection(null, 1186)).toBeNull();
  });
});
