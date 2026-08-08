import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { STORYBOARD_MATRIX_ROWS, StoryboardMatrixFieldCell } from "./StoryboardMatrix";

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
});
