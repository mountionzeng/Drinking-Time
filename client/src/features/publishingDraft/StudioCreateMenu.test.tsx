import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StudioCreateMenu } from "./StudioCreateMenu";

vi.stubGlobal("React", React);
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: React.PropsWithChildren) => <>{children}</>,
  PopoverTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>,
  PopoverContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));

function button(markup: string, label: string) {
  return markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find(html => html.includes(label));
}

describe("StudioCreateMenu", () => {
  it("keeps its entry available without a selected story and explains the prerequisite", () => {
    const html = renderToStaticMarkup(<StudioCreateMenu storyId={null} input="" blocked={false} hasShots={false} />);
    expect(button(html, "基于当前内容生成")).toBeDefined();
    expect(button(html, "基于当前内容生成")).not.toContain('disabled=""');
    expect(html).toContain("请先打开一个故事");
    expect(button(html, "图片")).toContain('disabled=""');
  });

  it("keeps the menu and layout usable while chat is busy", () => {
    const html = renderToStaticMarkup(<StudioCreateMenu storyId={7} input="" blocked hasShots />);
    expect(button(html, "基于当前内容生成")).toBeDefined();
    expect(button(html, "基于当前内容生成")).not.toContain('disabled=""');
    expect(button(html, "图文排版")).toBeDefined();
    expect(button(html, "图文排版")).not.toContain('disabled=""');
    expect(button(html, "图片")).toContain('disabled=""');
    expect(html).toContain("聊天正在处理内容");
  });

  it("offers generation again when ready and explains the music prerequisite", () => {
    const html = renderToStaticMarkup(<StudioCreateMenu storyId={7} input="暖色" blocked={false} hasShots={false} />);
    expect(button(html, "图片")).toBeDefined();
    expect(button(html, "图片")).not.toContain('disabled=""');
    expect(button(html, "视频")).not.toContain('disabled=""');
    expect(button(html, "音乐")).toContain('disabled=""');
    expect(html).toContain("先准备视频镜头");
  });
});
