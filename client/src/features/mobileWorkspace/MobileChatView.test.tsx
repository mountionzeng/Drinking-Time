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

  // 等回信时露一只小人加三个跳动的点，而不是那张给故障准备的琥珀色卡片。
  it("shows the typing bubble while a reply is in flight", () => {
    const waiting = { ...controller(), isSubmitting: true };
    const html = renderToStaticMarkup(
      <MobileChatView controller={waiting} element="water" storyTitle="旅行记" />
    );

    expect(html).toContain('data-testid="mobile-typing"');
    expect(html).toContain("正在回信…");
    // 故障样式不该在正常等待时出现
    expect(html).not.toContain("正在生成回复…");
  });

  it("hides the typing bubble once nothing is in flight", () => {
    const html = renderToStaticMarkup(
      <MobileChatView controller={controller()} element="water" storyTitle="旅行记" />
    );

    expect(html).not.toContain('data-testid="mobile-typing"');
  });

  // 刷新后从本地恢复出来的 replying 轮次，走同一只小人，不再各画各的。
  it("renders one indicator for a recovered replying turn, not two", () => {
    const recovered = {
      ...controller(),
      recoveryTurns: [
        {
          clientTurnId: "turn-1",
          storyId: 1,
          requestHash: "h",
          userClientMessageId: "u1",
          assistantClientMessageId: "a1",
          userContent: "在吗",
          assistantContent: "",
          status: "replying",
          error: null,
          updatedAt: 1,
        },
      ],
    } as unknown as MobileConversationController;
    const html = renderToStaticMarkup(
      <MobileChatView controller={recovered} element="water" storyTitle="旅行记" />
    );

    expect(html).toContain('data-testid="mobile-typing"');
    expect(html).not.toContain("待恢复的对话");
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
