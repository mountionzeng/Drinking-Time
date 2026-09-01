import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MobileStoryPicker } from "./MobileStoryPicker";

describe("MobileStoryPicker", () => {
  it("renders the owned stories in the server-provided order", () => {
    const html = renderToStaticMarkup(
      <MobileStoryPicker
        activeStoryId={42}
        disabled={false}
        onRequestStoryChange={vi.fn()}
        stories={[
          { id: 42, title: "刚刚修改的故事" },
          { id: 17, title: "较早的故事" },
        ]}
      />
    );

    expect(html.indexOf("刚刚修改的故事")).toBeLessThan(
      html.indexOf("较早的故事")
    );
    expect(html).toContain('aria-label="选择 Story"');
  });
});
