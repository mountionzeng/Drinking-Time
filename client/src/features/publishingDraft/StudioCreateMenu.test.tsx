import { UiLanguageContext } from "@/features/uiLanguage/UiLanguage";
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

  it("keeps the menu usable and removes redundant layout generation", () => {
    const html = renderToStaticMarkup(<StudioCreateMenu storyId={7} input="" blocked hasShots />);
    expect(button(html, "基于当前内容生成")).toBeDefined();
    expect(button(html, "基于当前内容生成")).not.toContain('disabled=""');
    expect(button(html, "图文排版")).toBeUndefined();
    expect(button(html, "图片")).toContain('disabled=""');
    expect(html).toContain("聊天正在处理内容");
  });

  it("offers music without requiring video shots", () => {
    const html = renderToStaticMarkup(<StudioCreateMenu storyId={7} input="暖色" blocked={false} hasShots={false} />);
    expect(button(html, "图片")).toBeDefined();
    expect(button(html, "图片")).not.toContain('disabled=""');
    expect(button(html, "视频")).not.toContain('disabled=""');
    expect(button(html, "音乐")).not.toContain('disabled=""');
    expect(html).not.toContain("先准备视频镜头");
  });
});

it("renders every create option and prerequisite in English", () => {
 const html=renderToStaticMarkup(<UiLanguageContext.Provider value={{language:"en",setLanguage:()=>{}}}><StudioCreateMenu storyId={null} input="用户原文" blocked={false} hasShots={false}/></UiLanguageContext.Provider>);
 expect(html).toContain("Create from this content");
 expect(html).toContain("Open a story before continuing.");
 for(const label of ["Images","Videos","Music"]) expect(html).toContain(label);
 expect(html).not.toMatch(/[\u3400-\u9fff]/);
});
