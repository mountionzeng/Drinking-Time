import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.stubGlobal("React", React);
vi.mock("@/lib/trpc", () => ({ trpc: { storyAgent: { storyMaterialState: { useQuery: () => ({ data: { shots: [] } }) } } } }));
vi.mock("./MobileImageStudio", () => ({ MobileImageStudio: () => null }));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: React.PropsWithChildren) => <>{children}</>,
  PopoverTrigger: ({ children }: React.PropsWithChildren) => <>{children}</>,
  PopoverContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
import { MobileCreateMenu } from "./MobileCreateMenu";

it("opens the same four choices without a selected memory or text-history dependency", () => {
  const html = renderToStaticMarkup(<MobileCreateMenu storyId={7} userId={8} instruction="" blocked={false} />);
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)!;
  expect(buttons.find(b => b.includes("基于当前内容生成"))).not.toContain('disabled=""');
  for (const label of ["图片", "视频", "图文排版"]) {
    const button = buttons.find(b => b.includes(label));
    expect(button).toBeDefined();
    expect(button).not.toContain('disabled=""');
  }
  expect(buttons.find(b => b.includes("音乐"))).toContain("先准备视频镜头");
});

it("keeps the entry and layout accessible while generation actions are blocked", () => {
  const html = renderToStaticMarkup(<MobileCreateMenu storyId={7} userId={8} instruction="" blocked />);
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)!;
  expect(buttons.find(b => b.includes("基于当前内容生成"))).not.toContain('disabled=""');
  expect(buttons.find(b => b.includes("图文排版"))).not.toContain('disabled=""');
  expect(buttons.find(b => b.includes("图片"))).toContain('disabled=""');
});
