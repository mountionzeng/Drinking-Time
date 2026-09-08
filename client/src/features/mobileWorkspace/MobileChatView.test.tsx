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

  // 等回信的样子由面板抬头那只小人代言；这里只保证 replying 不再以故障卡片
  // 的样子重复出现一遍。
  it("does not show the failure card for a turn that is still replying", () => {
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
      <MobileChatView controller={recovered} storyTitle="旅行记" />
    );

    expect(html).not.toContain("待恢复的对话");
    expect(html).not.toContain("正在生成回复…");
  });

  // 折叠时消息区是收起的，回信到了必须自己蹦出来——否则用户在常驻输入条
  // 发完消息，回信到了却毫无动静。
  it("pops the latest reply out while the sheet is collapsed", () => {
    const html = renderToStaticMarkup(
      <MobileChatView controller={controller()} dense storyTitle="旅行记" />
    );

    expect(html).toContain("我们从电脑上的内容继续。");
    expect(html).toContain('data-sheet-action="latest-reply"');
  });

  // 正在等回信时不露旧的那条，免得新旧混淆——那会儿抬头的小人正在动。
  it("holds the peek back while a new reply is still in flight", () => {
    const waiting = { ...controller(), isSubmitting: true };
    const html = renderToStaticMarkup(
      <MobileChatView controller={waiting} dense storyTitle="旅行记" />
    );

    expect(html).not.toContain('data-sheet-action="latest-reply"');
  });

  // 面板抬头已经有一只小人和「聊聊」二字了，每条气泡里再画一遍既吵又重复。
  it("does not repeat the avatar inside every assistant bubble", () => {
    const html = renderToStaticMarkup(
      <MobileChatView controller={controller()} storyTitle="旅行记" />
    );

    expect(html).toContain("我们从电脑上的内容继续。");
    expect(html).not.toContain('tracking-[0.16em]');
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
