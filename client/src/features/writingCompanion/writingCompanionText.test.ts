import { describe, expect, it } from "vitest";

import {
  insertParagraphAtCursor,
  replaceWritingSelection,
  writingCompanionErrorMessage,
} from "./writingCompanionText";

describe("insertParagraphAtCursor", () => {
  it("starts an empty draft with the paragraph itself", () => {
    expect(insertParagraphAtCursor("", 0, "  新的一段  ")).toEqual({
      body: "新的一段",
      cursor: 4,
    });
  });

  it("appends at the end on its own line", () => {
    expect(insertParagraphAtCursor("第一段", 3, "第二段")).toEqual({
      body: "第一段\n第二段",
      cursor: 7,
    });
  });

  it("does not double an existing line break", () => {
    expect(insertParagraphAtCursor("第一段\n", 4, "第二段").body).toBe(
      "第一段\n第二段"
    );
  });

  it("inserts between paragraphs without merging either side", () => {
    const draft = "开头\n结尾";
    const result = insertParagraphAtCursor(draft, 2, "中间");
    expect(result.body).toBe("开头\n中间\n结尾");
    expect(result.body.slice(0, result.cursor)).toBe("开头\n中间");
  });

  it("keeps the original text untouched when the paragraph is empty", () => {
    expect(insertParagraphAtCursor("原文", 1, "   ")).toEqual({
      body: "原文",
      cursor: 1,
    });
  });

  it("clamps a stale cursor that points past the end", () => {
    expect(insertParagraphAtCursor("原文", 99, "新段").body).toBe("原文\n新段");
  });
});

describe("replaceWritingSelection", () => {
  it("replaces only the selected text and returns the following cursor", () => {
    const draft = "今天下雨。我们去了公园。晚上回家。";
    const start = draft.indexOf("我们去了公园");
    const result = replaceWritingSelection(draft, {
      start,
      end: start + "我们去了公园".length,
    }, "我们去了开满花的公园");
    expect(result.body).toBe("今天下雨。我们去了开满花的公园。晚上回家。");
    expect(result.body.slice(0, start)).toBe("今天下雨。");
    expect(result.body.slice(result.cursor)).toBe("。晚上回家。");
  });
});

describe("writingCompanionErrorMessage", () => {
  it("passes through a server explanation such as low balance", () => {
    expect(
      writingCompanionErrorMessage(new Error("算力余额不足，无法调用 AI。"))
    ).toBe("算力余额不足，无法调用 AI。");
  });

  it("turns a raw network failure into a next step", () => {
    expect(writingCompanionErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "聊聊这次没接上，检查网络后再试一次。"
    );
  });
});
