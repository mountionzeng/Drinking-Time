import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import {
  conversationSections,
  MobileMemoryConversation,
} from "./MobileMemoryConversation";
import type { MobileConversationViewMessage } from "./mobileConversationStore";
import type { MobileConversationController } from "./MobileChatView";
const at = 1791800000000;
const messages: MobileConversationViewMessage[] = [
  {
    id: "a",
    role: "assistant",
    content: "当时你在哪里？",
    timestamp: at,
    source: "server",
  },
  {
    id: "b",
    role: "user",
    content: "我在爷爷的修伞铺。",
    timestamp: at + 1000,
    source: "server",
  },
  {
    id: "c",
    role: "assistant",
    content: "后来发生了什么？",
    timestamp: at + 2000,
    source: "server",
  },
  {
    id: "d",
    role: "user",
    content: "下一段回忆",
    timestamp: at + 3600000,
    source: "server",
  },
  {
    id: "e",
    role: "user",
    content: "尚未同步",
    timestamp: at + 3600001,
    source: "recovery",
  },
];
it("groups by actual pauses, retains adjacent context, and excludes unsaved recovery", () => {
  const groups = conversationSections(messages);
  expect(groups.map(g => g.messages.map(m => m.id))).toEqual([
    ["a", "b", "c"],
    ["d"],
  ]);
  expect(groups.flatMap(g => g.messages.map(m => m.content))).toEqual(
    messages.slice(0, 4).map(m => m.content)
  );
});
it("shows an index and full original context without per-message action clutter or mutations", () => {
  const make = vi.fn();
  const html = renderToStaticMarkup(
    <MobileMemoryConversation
      storyId={7}
      conversation={
        { messages, historyState: "loaded" } as MobileConversationController
      }
      onMakeArtwork={make}
    />
  );
  expect(html).toContain("聊天目录");
  expect(html).toContain("当时你在哪里？");
  expect(html).toContain("后来发生了什么？");
  expect(html).not.toContain("尚未同步");
  expect(html).not.toContain("制作图文 →");
  expect(make).not.toHaveBeenCalled();
});
