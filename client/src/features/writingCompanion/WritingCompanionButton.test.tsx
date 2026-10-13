import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WritingCompanionButton } from "./WritingCompanionButton";
import { assertWritingSnapshotCurrent } from "./writingCompanionText";

describe("writing companion editor boundary", () => {
  it("renders the closed, accessible trigger without a provider or any work", () => {
    const resolveStoryId = vi.fn();
    const getSnapshot = vi.fn();
    const onInsert = vi.fn();
    const html = renderToStaticMarkup(
      <WritingCompanionButton {...{ resolveStoryId, getSnapshot, onInsert }} />
    );
    expect(html).toContain("和小忆聊聊，帮我继续写");
    expect(html).toContain("xiaoyi-avatar.png");
    expect(html).not.toContain("回答小忆");
    expect(resolveStoryId).not.toHaveBeenCalled();
    expect(getSnapshot).not.toHaveBeenCalled();
    expect(onInsert).not.toHaveBeenCalled();
  });
  it.each([
    { draft: "新正文", cursor: 1, scope: "story:version:platform:revision" },
    { draft: "原正文", cursor: 1, scope: "different-story" },
    { draft: "原正文", cursor: 1, scope: "different-version" },
  ])("rejects insertion into a changed buffer or scope: %j", current => {
    expect(() =>
      assertWritingSnapshotCurrent(
        {
          draft: "原正文",
          cursor: 2,
          scope: "story:version:platform:revision",
        },
        current
      )
    ).toThrow("暂未插入");
  });
  it("retains the original insertion location even when focus moved", () => {
    const original = {
      draft: "原正文",
      cursor: 2,
      scope: "story:version:platform:revision",
    };
    expect(() =>
      assertWritingSnapshotCurrent(original, { ...original, cursor: 0 })
    ).not.toThrow();
  });
  it("rejects a changed selection even while the surrounding draft is intact", () => {
    const original = {
      draft: "前文。选中句。后文。",
      cursor: 3,
      scope: "story:version:platform:revision",
      selection: { start: 3, end: 7 },
    };
    expect(() =>
      assertWritingSnapshotCurrent(original, {
        ...original,
        selection: { start: 8, end: 10 },
      })
    ).toThrow("暂未插入");
  });
});
