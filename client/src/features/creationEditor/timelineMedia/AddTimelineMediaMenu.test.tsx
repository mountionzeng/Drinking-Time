import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AddTimelineMediaMenu,
  TIMELINE_MEDIA_ADD_ITEMS,
} from "./AddTimelineMediaMenu";

vi.stubGlobal("React", React);

describe("AddTimelineMediaMenu", () => {
  it("names the six creation routes without asking the system to guess a type", () => {
    expect(TIMELINE_MEDIA_ADD_ITEMS.map(item => item.label)).toEqual([
      "从当前文字生成字幕",
      "从字幕生成旁白",
      "导入音乐",
      "导入环境声",
      "导入音效",
      "从 ChatCut 导入原声",
    ]);
  });

  it("keeps one discoverable trigger and supports the folded Add Sound label", () => {
    const html = renderToStaticMarkup(
      <AddTimelineMediaMenu
        triggerLabel="添加声音"
        availableActions={["import-music", "import-ambience", "import-sfx"]}
        onPick={vi.fn()}
      />
    );
    expect(html).toContain("添加声音");
    expect(html).toContain('aria-haspopup="menu"');
  });
});
