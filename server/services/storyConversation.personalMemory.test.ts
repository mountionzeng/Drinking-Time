import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { TrpcContext } from "../_core/context";
import { listPersonalMemoryEvents, resetMemoryStateForTesting } from "../db";
import { appRouter } from "../routers";
import { appendStoryConversationTurn } from "./storyConversation";

const CAPTURED_USER = 901;
const UNLISTED_USER = 902;

const previousAllowlist = process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS;
process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS = String(CAPTURED_USER);

afterAll(() => {
  if (previousAllowlist === undefined) {
    delete process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS;
  } else {
    process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS = previousAllowlist;
  }
});

function context(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `pm-capture-user-${userId}`,
      email: `pm-capture-${userId}@example.com`,
      name: `Capture User ${userId}`,
      loginMethod: "test",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      sessionVersion: 1,
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

async function seedStory(userId: number) {
  const caller = appRouter.createCaller(context(userId));
  const story = await caller.storyAgent.storyUpsert({
    title: "捕获测试",
    body: { cards: [], characters: [], shots: [] },
  });
  await caller.promptLineage.getStoryProjection({ storyId: story!.id });
  return story!;
}

function turn(storyId: number, userId: number, suffix: string, content: string) {
  return {
    storyId,
    userId,
    userMessage: {
      clientMessageId: `user-${suffix}`,
      content,
    },
    assistantMessage: {
      clientMessageId: `assistant-${suffix}`,
      content: `助手回答-${suffix}`,
    },
  };
}

describe("普通聊天在服务端成功边界捕获用户文字", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
  });

  it("提交成功后恰好产生一条用户经历", async () => {
    const story = await seedStory(CAPTURED_USER);
    await appendStoryConversationTurn(
      turn(story.id, CAPTURED_USER, "a", "最近在学游泳")
    );

    const events = await listPersonalMemoryEvents(CAPTURED_USER);
    expect(events).toHaveLength(1);
    expect(events[0].sourceType).toBe("chat_message");
    expect(events[0].actionKind).toBe("submitted");
    expect(events[0].snapshot.excerpt).toBe("最近在学游泳");
  });

  // 助手说的话不是用户的经历。这条如果失效，记忆会开始把模型的输出当成
  // 用户自己的想法反刍回来。
  it("助手消息不产生经历", async () => {
    const story = await seedStory(CAPTURED_USER);
    await appendStoryConversationTurn(
      turn(story.id, CAPTURED_USER, "a", "最近在学游泳")
    );

    const events = await listPersonalMemoryEvents(CAPTURED_USER);
    expect(events).toHaveLength(1);
    expect(
      events.every(event => !event.snapshot.excerpt?.includes("助手回答"))
    ).toBe(true);
  });

  it("经历指向标准化消息行，而不是客户端 ID", async () => {
    const story = await seedStory(CAPTURED_USER);
    await appendStoryConversationTurn(
      turn(story.id, CAPTURED_USER, "a", "最近在学游泳")
    );

    const [event] = await listPersonalMemoryEvents(CAPTURED_USER);
    expect(event.sourceKey).toMatch(/^message:\d+$/);
    expect(event.actionId).toBe("user-a");
  });

  it("每条经历带一个 pending 提炼任务，但 runner 未启动", async () => {
    const story = await seedStory(CAPTURED_USER);
    await appendStoryConversationTurn(
      turn(story.id, CAPTURED_USER, "a", "最近在学游泳")
    );
    const events = await listPersonalMemoryEvents(CAPTURED_USER);
    expect(events).toHaveLength(1);
  });

  it("两轮不同对话各自成一条经历", async () => {
    const story = await seedStory(CAPTURED_USER);
    await appendStoryConversationTurn(
      turn(story.id, CAPTURED_USER, "a", "最近在学游泳")
    );
    await appendStoryConversationTurn(
      turn(story.id, CAPTURED_USER, "b", "今天有点累")
    );

    const events = await listPersonalMemoryEvents(CAPTURED_USER);
    expect(events).toHaveLength(2);
    // 按 occurredAt DESC 返回，最新的在前。
    expect(events.map(event => event.actionId)).toContain("user-a");
    expect(events.map(event => event.actionId)).toContain("user-b");
  });

  // 同一 client message ID 重试是安全的：既有轮会被原样接受，
  // 不能因此多出第二条经历。
  it("重复提交同一轮不产生第二条经历", async () => {
    const story = await seedStory(CAPTURED_USER);
    const input = turn(story.id, CAPTURED_USER, "a", "最近在学游泳");
    await appendStoryConversationTurn(input);
    await appendStoryConversationTurn(input);
    await appendStoryConversationTurn(input);

    expect(await listPersonalMemoryEvents(CAPTURED_USER)).toHaveLength(1);
  });

  // Phase 1 的硬门槛：没列进白名单的账号一条都不捕获。
  it("不在白名单的账号完全不产生经历，但聊天正常保存", async () => {
    const story = await seedStory(UNLISTED_USER);
    const conversation = await appendStoryConversationTurn(
      turn(story.id, UNLISTED_USER, "a", "我也说了话")
    );

    expect(conversation.messages.length).toBeGreaterThan(0);
    expect(await listPersonalMemoryEvents(UNLISTED_USER)).toHaveLength(0);
  });

  it("两个账号的经历互相看不见", async () => {
    const mine = await seedStory(CAPTURED_USER);
    const theirs = await seedStory(UNLISTED_USER);
    await appendStoryConversationTurn(
      turn(mine.id, CAPTURED_USER, "a", "我的话")
    );
    await appendStoryConversationTurn(
      turn(theirs.id, UNLISTED_USER, "a", "他的话")
    );

    const events = await listPersonalMemoryEvents(CAPTURED_USER);
    expect(events).toHaveLength(1);
    expect(events[0].snapshot.excerpt).toBe("我的话");
  });
});
