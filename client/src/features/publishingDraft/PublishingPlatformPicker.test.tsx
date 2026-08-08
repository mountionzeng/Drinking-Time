import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PublishingPlatformPickerView } from "./PublishingPlatformPicker";

vi.stubGlobal("React", React);

describe("PublishingPlatformPickerView", () => {
  it("shows one active platform and independent selected publishing targets", () => {
    const html = renderToStaticMarkup(
      <PublishingPlatformPickerView
        activePlatform="xiaohongshu"
        selectedPlatforms={["xiaohongshu", "x", "linkedin"]}
        onActivePlatformChange={vi.fn()}
        onToggleTarget={vi.fn()}
      />
    );

    expect(html).toContain('aria-label="当前写作平台"');
    expect(html).toContain('aria-label="也想发布到"');
    expect(html).toContain("小红书");
    expect(html).toContain("Instagram");
    expect(html).toContain("朋友圈");
    expect(html).toContain("抖音 / TikTok");
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html).toContain("flex-wrap");
    expect(html).not.toContain("overflow-x-auto");
  });

  it("compact mode keeps each platform group on a single scrollable line", () => {
    const html = renderToStaticMarkup(
      <PublishingPlatformPickerView
        activePlatform="xiaohongshu"
        selectedPlatforms={["xiaohongshu", "x"]}
        onActivePlatformChange={vi.fn()}
        onToggleTarget={vi.fn()}
        compact
      />
    );

    expect(html).toContain("overflow-x-auto");
    expect(html).not.toContain("flex-wrap");
    expect(html).not.toContain("选择不会自动生成");
    expect(html).toContain('aria-label="当前写作平台"');
    expect(html).toContain('aria-label="也想发布到"');
  });

  it("disables every control while one selection request is in flight", () => {
    const html = renderToStaticMarkup(
      <PublishingPlatformPickerView
        activePlatform="x"
        selectedPlatforms={["x"]}
        onActivePlatformChange={vi.fn()}
        onToggleTarget={vi.fn()}
        disabled
      />
    );

    expect(html.match(/disabled=""/g)?.length).toBe(11);
  });
});
