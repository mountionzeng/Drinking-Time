import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.stubGlobal("React", React);
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <>{children}</>,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
  PopoverContent: ({ children }: any) => <>{children}</>,
}));
import { BookSendMenu } from "./BookSendMenu";

it("keeps delivery and return options gated and never sends during render", () => {
  const onShareText = vi.fn(),
    onPlatform = vi.fn(),
    onCreateLink = vi.fn(),
    onInbox = vi.fn(),
    onReturn = vi.fn();
  const render = (delivery?: Parameters<typeof BookSendMenu>[0]["delivery"]) =>
    renderToStaticMarkup(
      <BookSendMenu
        disabled={false}
        onShare={onShareText}
        onPlatform={onPlatform}
        delivery={delivery}
      />
    );
  expect(render()).toContain("分享文章");
  expect(render()).not.toContain("生成故事链接");
  expect(render()).toContain("朋友圈");
  expect(render()).toContain("其他平台");
  expect(render()).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?小程序/);
  expect(render()).toContain("暂未启用");
  expect(render({ onCreateLink, onInbox })).not.toContain("暂未启用");
  expect(render({ onCreateLink, onInbox })).toContain("收件箱");
  expect(render({ onCreateLink, onInbox })).not.toContain("发回修改稿");
  expect(render({ onCreateLink, onInbox, onReturn })).toContain("发回修改稿");
  for (const fn of [onShareText, onPlatform, onCreateLink, onInbox, onReturn])
    expect(fn).not.toHaveBeenCalled();
});
