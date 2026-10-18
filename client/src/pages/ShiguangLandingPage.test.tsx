import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ShiguangLandingPage, { makerEntryUrl } from "./ShiguangLandingPage";

afterEach(() => vi.unstubAllGlobals());

describe("ShiguangLandingPage", () => {
  it("presents the cross-device story and offers the maker choice", () => {
    const html = renderToStaticMarkup(<ShiguangLandingPage />);

    expect(html).toContain("有些事说不清楚");
    expect(html).toContain("接住你和家人的所有思绪");
    expect(html).toContain("最快捷地生成美丽的私人影像");
    expect(html.match(/aria-haspopup="dialog"/g)).toHaveLength(2);
    expect(html.match(/<video/g)).toHaveLength(2);
    expect(html.match(/controls=""/g)).toHaveLength(2);
    expect(html).toContain("点开小忆，随时记录情绪");
    expect(html).toContain("剪辑时间线与图文排版操作演示");
    expect(html).toContain("/shiguang/landing/mobile-demo.mp4");
    expect(html).toContain("/shiguang/landing/desktop-demo.mp4");
    expect(html).not.toContain("shiguang-note-ui");
    expect(html).not.toContain("shiguang-storyboard-ui");
    expect(html).not.toContain("shiguang-hero-art");
    expect(html).not.toContain("/shiguang/landing/book-edges.png");
    expect(html).not.toContain("/shiguang/landing/curved-branch.png");
    expect(html).not.toContain("/shiguang/landing/story-paper.png");
  });

  it("renders an English page with five-element artwork", () => {
    vi.stubGlobal("window", { location: { search: "?lang=en" } });
    const html = renderToStaticMarkup(<ShiguangLandingPage />);

    expect(html).toContain("Nature changes.");
    expect(html).toContain("So do we.");
    expect(html).toContain("They won’t tell you who you are.");
    expect(html).toContain("A place for your feelings, whenever they arrive");
    expect(html).not.toContain("shiguang-note-ui");
    expect(html).not.toContain("shiguang-storyboard-ui");
    expect(html.match(/<video/g)).toHaveLength(2);
    expect(html).toContain("/shiguang/landing/nayin-mobile-demo.mp4");
    expect(html).toContain("/shiguang/landing/nayin-desktop-demo.mp4");
    expect(html).toContain("Nayin: timeline editing and page layout");
    expect(html).not.toContain('src="/shiguang/landing/mobile-demo.mp4"');
    expect(html).not.toContain("family");
    expect(html).toContain("shiguang-landing--en");
    expect(html.match(/THE FIVE ELEMENTS/g)).toHaveLength(1);
    expect(html).toContain("aria-current=\"page\">EN");
    expect(html).not.toContain("English version coming soon");
  });

  it("selects Nayin only for the English maker entry", () => {
    expect(makerEntryUrl("https://www.drinkingtime.top/m", true)).toBe(
      "https://www.drinkingtime.top/m?visualTheme=nayin"
    );
    expect(makerEntryUrl("https://www.drinkingtime.top/editing", false)).toBe(
      "https://www.drinkingtime.top/editing"
    );
  });
});
