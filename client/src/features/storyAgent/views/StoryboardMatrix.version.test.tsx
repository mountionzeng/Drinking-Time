import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StoryboardFieldVersionSelect } from "./StoryboardMatrix";

vi.stubGlobal("React", React);

describe("StoryboardFieldVersionSelect", () => {
  it("shows independent current and historical revisions for one column", () => {
    const html = renderToStaticMarkup(
      <StoryboardFieldVersionSelect
        label="图片要求"
        track={{
          currentRevision: 3,
          history: [1, 2, 3].map(revision => ({
            revision,
            createdAt: revision,
            source: revision === 3 ? "restored" : "edited",
            values: {},
          })),
        }}
        restoring={false}
        onRestore={vi.fn()}
      />
    );

    expect(html).toContain('aria-label="图片要求版本"');
    expect(html).toContain("V3 · 当前");
    expect(html).toContain("V2");
    expect(html).toContain("V1");
  });
});
