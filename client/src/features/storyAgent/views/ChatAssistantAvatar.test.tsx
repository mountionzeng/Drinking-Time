import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ChatAssistantAvatar from "./ChatAssistantAvatar";

describe("ChatAssistantAvatar", () => {
  it("uses the shiguang bird portrait in the illustration theme", () => {
    const html = renderToStaticMarkup(
      <ChatAssistantAvatar visualTheme="shiguang" element="water" />
    );

    expect(html).toContain("/shiguang/xiaoyi-avatar.png");
    expect(html).toContain("chat-assistant-avatar-shiguang");
    expect(html).not.toContain("<svg");
  });

  // 纳音主题的头像要跟着当天五行走，所以这里必须是 EmotiveWuxingIcon 的
  // 矢量小人，而不是拾光那张固定的小鸟图。
  it("uses the wuxing icon in the nayin theme", () => {
    const html = renderToStaticMarkup(
      <ChatAssistantAvatar visualTheme="nayin" element="fire" />
    );

    expect(html).toContain("<svg");
    expect(html).not.toContain("xiaoyi-avatar");
  });

  // 头像是纯装饰：气泡里的文字已经说明了这是谁的话，
  // 读屏再念一遍「头像」只会打断阅读。
  it("hides itself from assistive technology", () => {
    const html = renderToStaticMarkup(
      <ChatAssistantAvatar visualTheme="shiguang" element="wood" />
    );

    expect(html).toContain('aria-hidden="true"');
  });

  it("carries the class the stylesheet positions against", () => {
    const html = renderToStaticMarkup(
      <ChatAssistantAvatar visualTheme="shiguang" element="metal" />
    );

    expect(html).toContain("chat-assistant-avatar");
  });
});
