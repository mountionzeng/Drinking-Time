import { describe, expect, it } from "vitest";
import { lineContextMessage } from "./writingCompanion";

const draft = "第一行\n第二行很长\n第三行";

describe("lineContextMessage", () => {
  it("is empty when the switch is off", () => {
    expect(lineContextMessage({ draft, cursor: 5 }, false)).toBe("");
  });
  it("names the line and its neighbours when on", () => {
    const text = lineContextMessage({ draft, cursor: 5 }, true);
    expect(text).toContain("第 2 行（共 3 行）");
    expect(text).toContain("这一行：第二行很长");
    expect(text).toContain("前面：第一行");
    expect(text).toContain("后面：第三行");
    expect(text).toContain("不要直接替他改字");
  });
  it("is empty for blank text", () => {
    expect(lineContextMessage({ draft: "", cursor: 0 }, true)).toBe("");
  });
});

it("honors the selection start and original CRLF offsets; invalid cursors do not claim a line", () => {
  expect(lineContextMessage({ draft: "甲\r\n乙\r\n丙", cursor: 6 }, true)).toContain("第 3 行");
  expect(lineContextMessage({ draft, cursor: draft.length, selection: { start: 5, end: 7 } }, true)).toContain("第 2 行");
  expect(lineContextMessage({ draft, cursor: 999 }, true)).toBe("");
});

import { ENV } from "../_core/env";
import { replyAsWritingCompanion } from "./writingCompanion";
import { moduleCompanionContext } from "../../client/src/features/publishingAlbum/moduleCompanionContext";
import { newTextModule } from "../../client/src/features/publishingAlbum/imagePackModules";
import { vi } from "vitest";

it("routes selected module line context through the existing reply call only with the flag", async () => {
  const original = ENV.lineContextChatEnabled;
  const module = moduleCompanionContext({ storyId: 7, scope: "scope", document: { version: 1, pages: [{ label: "正文", modules: [newTextModule("a", "前文", () => 20), newTextModule("b", "当前行", () => 20)] }] }, pageIndex: 0, selectedId: "b", renderer: { draw: () => {} } })!;
  const invoke = vi.fn(async () => ({ text: "想往哪个方向写？", modelLabel: "mock" }));
  try {
    for (const enabled of [false, true]) {
      ENV.lineContextChatEnabled = enabled;
      await replyAsWritingCompanion({ message: "这一行呢", history: [], writingContext: { draft: module.pageText, cursor: 0, module } }, invoke);
      const sent = JSON.stringify(invoke.mock.calls.at(-1));
      expect(sent.includes("当前排版顺序第 2 行")).toBe(enabled);
      expect(sent.includes("他说出想法后才给具体改写")).toBe(enabled);
    }
    expect(invoke).toHaveBeenCalledTimes(2);
  } finally { ENV.lineContextChatEnabled = original; }
});
