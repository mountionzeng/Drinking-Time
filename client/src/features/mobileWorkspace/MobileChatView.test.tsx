import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  MobileChatView,
  shouldSubmitMobileChatKey,
  type MobileConversationController,
} from "./MobileChatView";

function controller(): MobileConversationController {
  return {
    historyState: "loaded",
    historyError: null,
    messages: [
      {
        id: "server-1",
        role: "assistant",
        content: "我们从电脑上的内容继续。",
        timestamp: 1,
        source: "server",
      },
    ],
    recoveryTurns: [],
    canSend: true,
    isSubmitting: false,
    submit: vi.fn(),
    retryTurn: vi.fn(),
    discardRecoveryTurn: vi.fn(),
    reloadHistory: vi.fn(),
  };
}

describe("MobileChatView", () => {
  it("renders the durable conversation and a named, reachable composer", () => {
    const html = renderToStaticMarkup(
      <MobileChatView controller={controller()} storyTitle="旅行记" />
    );

    expect(html).toContain("我们从电脑上的内容继续。");
    expect(html).toContain('aria-label="给聊聊发送消息"');
    expect(html).toContain("发送");
  });

  it("submits only a plain Enter outside IME composition", () => {
    expect(
      shouldSubmitMobileChatKey({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
      })
    ).toBe(true);
    expect(
      shouldSubmitMobileChatKey({
        key: "Enter",
        shiftKey: false,
        isComposing: true,
      })
    ).toBe(false);
    expect(
      shouldSubmitMobileChatKey({
        key: "Enter",
        shiftKey: true,
        isComposing: false,
      })
    ).toBe(false);
  });
});
