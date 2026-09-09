import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ChatPhotoExtractionQuestion from "./ChatPhotoExtractionQuestion";

vi.stubGlobal("React", React);
describe("ChatPhotoExtractionQuestion", () => {
  it("asks inside chat, offers optional replies, and never sends on render", () => {
    const reply = vi.fn();
    const markup = renderToStaticMarkup(
      <ChatPhotoExtractionQuestion disabled={false} onReply={reply} />
    );
    expect(markup).toContain("你想提取图片里的哪一部分？");
    expect(markup).toContain('role="status"');
    expect(markup).toContain("左边的花瓶，不要背景");
    expect(markup).toContain("只保存图片");
    expect(markup).toContain("发送后才上传处理");
    expect(reply).not.toHaveBeenCalled();
  });
  it("disables every quick reply while processing", () => {
    const markup = renderToStaticMarkup(
      <ChatPhotoExtractionQuestion disabled onReply={vi.fn()} />
    );
    expect(markup.match(/disabled=""/g)).toHaveLength(6);
  });
});
