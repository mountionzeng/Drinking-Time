import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

import { PublishingAlbumPagePreview } from "./PublishingAlbumPagePreview";

const plan = {
  kind: "path" as const,
  text: "风起<无字>&归来",
  fontId: "zhi-mang-xing",
  fontFamily: "Publishing Album Zhi Mang Xing",
  fontSize: 42,
  alignment: "center" as const,
  graphemes: [{ grapheme: "<无字>&", index: 0, x: 100, y: 200, rotation: 10 }],
  contrast: { textColor: "#fff", outlineColor: "#000", outlineWidth: 1, backdropColor: null },
  svgPath: "M10 100 L890 200",
};

describe("PublishingAlbumPagePreview", () => {
  it("renders the exact positioned glyph plan used by export without unsafe interpolation", () => {
    const html = renderToStaticMarkup(<PublishingAlbumPagePreview backgroundUrl="/image.png" plan={plan} />);
    expect(html).not.toContain("<textPath");
    expect(html).toContain("M10 100 L890 200");
    expect(html).toContain("&lt;无字&gt;&amp;");
    expect(html).not.toContain("<无字>");
  });

  it("labels candidate previews so they cannot look adopted", () => {
    const html = renderToStaticMarkup(<PublishingAlbumPagePreview backgroundUrl="/candidate.png" plan={null} candidate />);
    expect(html).toContain("候选 · 尚未采用");
    expect(html).toContain('data-candidate="true"');
  });
});
