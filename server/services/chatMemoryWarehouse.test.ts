import { beforeEach, describe, expect, it } from "vitest";
import {
  buildChatMemoryCards,
  syncChatMemoryPage,
  syncStoryChatMemories,
} from "./chatMemoryWarehouse";
import {
  archiveMemoryCard,
  listMemoryCards,
} from "../repositories/memoryCards";
import { createStory } from "../repositories/stories";
import { resetMemoryStateForTesting } from "../repositories/runtime";
import { appRouter } from "../routers";
import { appendStoryConversationTurn } from "./storyConversation";
import type { TrpcContext } from "../_core/context";
import { memoryCardSnapshotSchema } from "../../shared/memoryWarehouse";

process.env.DATABASE_URL = "";
const owner = { userId: 812, storyId: 1 };
const fallbackDate = new Date("2026-10-10T00:00:00Z");
const caller = (id: number) =>
  appRouter.createCaller({
    user: { id },
    req: { headers: {} },
    res: {},
  } as TrpcContext);
beforeEach(() => resetMemoryStateForTesting());

describe("all chat is reusable memory", () => {
  it("merges the legacy and durable copies, preserves speakers and excludes non-conversation sources", () => {
    const cards = buildChatMemoryCards({
      ...owner,
      fallbackDate,
      messages: [
        { id: "u1", role: "user", content: "今天在想搬家的事。" },
        { role: "system", content: "系统提示" },
      ],
      durableMessages: [
        {
          id: 123,
          clientMessageId: "u1",
          role: "user",
          content: "今天在想搬家的事。",
        },
        {
          id: 124,
          clientMessageId: "a1",
          role: "assistant",
          content: "想从哪里开始聊？",
        },
        { role: "user", content: "他人的分享", source: "story-context-share" },
      ],
    });
    expect(cards).toHaveLength(2);
    expect(cards.map(card => card.origin)).toEqual(["user", "assistant"]);
    expect(cards.every(card => card.kind === "conversation")).toBe(true);
    expect(cards[0].content).toBe("今天在想搬家的事。");
    const again = buildChatMemoryCards({
      ...owner,
      fallbackDate,
      messages: [],
      durableMessages: [
        {
          id: 999,
          clientMessageId: "u1",
          role: "user",
          content: cards[0].content,
        },
      ],
    });
    expect(again[0].id).toBe(cards[0].id);
  });
  it("keeps every character of long conversations and creates a distinct revision for edits", () => {
    const content = "  " + "这是一段长记忆🌿".repeat(2000) + " ";
    const cards = buildChatMemoryCards({
      ...owner,
      fallbackDate,
      messages: [{ id: "m", role: "user", content }],
      durableMessages: [],
    });
    expect(cards.length).toBeGreaterThan(1);
    expect(cards.map(card => card.content).join("")).toBe(content);
    expect(cards.map(card => memoryCardSnapshotSchema.parse({ ...card, createdAt: card.createdAt.getTime() }).content).join("")).toBe(content);
    expect(cards.every(card => card.content.length <= 12000)).toBe(true);
    const edited = buildChatMemoryCards({
      ...owner,
      fallbackDate,
      messages: [{ id: "m", role: "user", content: "修正后的说法" }],
      durableMessages: [],
    });
    expect(edited[0].id).not.toBe(cards[0].id);
  });
  it("backfills every page, isolates accounts and does not restore archived memories", async () => {
    for (let i = 0; i < 22; i++)
      await createStory({
        userId: owner.userId,
        title: `聊天${i}`,
        body: {
          messages: [{ id: `m${i}`, role: "user", content: `第${i}个念头` }],
        },
      });
    await createStory({
      userId: 999,
      title: "另一账号",
      body: { messages: [{ id: "private", role: "user", content: "私有" }] },
    });
    const first = await syncChatMemoryPage(owner.userId, 0);
    expect(first.nextAfterId).not.toBeNull();
    expect(
      (await syncChatMemoryPage(owner.userId, first.nextAfterId!)).nextAfterId
    ).toBeNull();
    const cards = await listMemoryCards(owner.userId, 0, 100, false);
    expect(cards).toHaveLength(22);
    expect(cards.some(card => card.content === "私有")).toBe(false);
    await archiveMemoryCard(owner.userId, cards[0].id, true);
    await syncStoryChatMemories({ ...owner, storyId: cards[0].sourceStoryId! });
    expect(await listMemoryCards(owner.userId, 0, 100, false)).toHaveLength(21);
    expect(await listMemoryCards(owner.userId, 0, 100, true)).toHaveLength(1);
    await expect(
      syncStoryChatMemories({ storyId: 1, userId: 999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("automatically collects normal saves and completed turns without a manual save-card action", async () => {
    const api = caller(owner.userId);
    const story = await api.storyAgent.storyUpsert({
      title: "随便聊",
      body: {
        messages: [{ id: "first", role: "user", content: "今天的天空很好看" }],
        shots: [],
      },
    });
    expect(await listMemoryCards(owner.userId, 0, 100, false)).toHaveLength(1);
    await appendStoryConversationTurn({
      userId: owner.userId,
      storyId: story!.id,
      userMessage: { clientMessageId: "u2", content: "我想起小时候放学的路" },
      assistantMessage: {
        clientMessageId: "a2",
        content: "那条路是什么样的？",
      },
    });
    expect(await listMemoryCards(owner.userId, 0, 100, false)).toHaveLength(3);
    await api.storyAgent.storyDelete({ id: story!.id });
    expect(await listMemoryCards(owner.userId, 0, 100, false)).toHaveLength(3);
  });
});
