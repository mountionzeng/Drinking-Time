import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  STORYBOARD_MATRIX_ROWS,
  STORYBOARD_MATRIX_VISIBLE_ROWS,
  StoryboardMatrixFieldCell,
  StoryboardVoiceCell,
} from "./StoryboardMatrix";

vi.stubGlobal("React", React);

describe("StoryboardMatrixFieldCell accessibility", () => {
  it("associates the script description with its editable cell", () => {
    const row = STORYBOARD_MATRIX_ROWS.find(item => item.field === "scriptText")!;
    const html = renderToStaticMarkup(
      <StoryboardMatrixFieldCell
        value="可表演的剧本"
        row={row}
        shotLabel="01"
        selected={false}
        dropTarget={false}
        editable
        onFocus={vi.fn()}
        onCommit={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        onDragOver={vi.fn()}
        onDragLeave={vi.fn()}
        onDrop={vi.fn()}
      />
    );

    expect(html).toContain('aria-describedby="storyboard-scriptText-01-description"');
    expect(html).toContain('id="storyboard-scriptText-01-description"');
    expect(html).toContain("文字稿转写 · 可表演/可执行");
  });

  it("shows one voice row with separate narration and sound editing", () => {
    expect(STORYBOARD_MATRIX_VISIBLE_ROWS.map(row => row.field)).toEqual([
      "promptDraft",
      "videoPrompt",
      "dialogue",
    ]);
    const videoRow = STORYBOARD_MATRIX_ROWS.find(
      item => item.field === "videoPrompt"
    )!;
    expect(`${videoRow.description} ${videoRow.placeholder}`).not.toMatch(
      /旁白|声音/
    );

    const html = renderToStaticMarkup(
      <StoryboardVoiceCell
        shot={{
          shotNo: 1,
          subject: "人物",
          action: "抬头",
          scriptText: "文字稿原文",
          dialogue: "文字稿原文",
          shotType: "中景",
          beat: "开场",
          cameraAngle: "",
          cameraMove: "",
          location: "",
          timeLight: "",
          mood: "",
          sound: "纸张摩擦声",
          styleRef: "",
          note: "",
          emotion: "克制",
          sourceCardContent: "",
        }}
        shotLabel="0101"
        selected={false}
        editable
        generating={false}
        onFocus={vi.fn()}
        onCommit={vi.fn()}
        onGenerate={vi.fn()}
      />
    );

    expect(html).toContain("旁白 / 对白");
    expect(html).toContain("文字稿原文");
    expect(html).toContain("背景音 / 音效");
    expect(html).toContain("纸张摩擦声");
    expect(html).toContain("生成旁白");
  });
});
