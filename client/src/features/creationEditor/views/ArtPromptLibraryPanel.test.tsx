import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ArtPromptLibraryPanel from "./ArtPromptLibraryPanel";

vi.stubGlobal("React", React);

describe("ArtPromptLibraryPanel", () => {
  it("renders current binding, reusable dimensions, and import affordance", () => {
    const html = renderToStaticMarkup(
      <ArtPromptLibraryPanel
        currentLibraryVersionId={12}
        versions={[
          {
            library: {
              id: 4,
              kind: "user",
              name: "写实记录",
              description: "适合真实工作现场",
            },
            version: {
              id: 12,
              version: 3,
              source: "obsidian://styles/documentary",
            },
            items: [
              {
                dimension: "visual_style",
                content: "documentary realism",
                negativeContent: null,
              },
              {
                dimension: "lighting",
                content: "soft directional key",
                negativeContent: null,
              },
            ],
          },
        ]}
        onImport={async () => {}}
        onBind={async () => {}}
      />,
    );

    expect(html).toContain("美术提示词库");
    expect(html).toContain("写实记录 · v3");
    expect(html).toContain("当前");
    expect(html).toContain("风格");
    expect(html).toContain("光线");
    expect(html).toContain("导入");
  });
});
