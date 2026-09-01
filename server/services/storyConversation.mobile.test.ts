import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeStoryConversationTurnRequestHash } from "../../shared/promptLineage";
import type { TrpcContext } from "../_core/context";
import { resetMemoryStateForTesting } from "../db";
import { appRouter } from "../routers";
import {
  StoryConversationIdempotencyConflictError,
  appendMobileStoryConversationTurn,
  generateMobileStoryConversationTurn,
  getMobileStoryConversationTurnStatus,
} from "./storyConversation";

function context(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `mobile-turn-user-${userId}`,
      email: `mobile-turn-${userId}@example.com`,
      name: `Mobile Turn User ${userId}`,
      loginMethod: "test",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

async function seedStory(userId = 801) {
  const caller = appRouter.createCaller(context(userId));
  const story = await caller.storyAgent.storyUpsert({
    title: "移动聊聊测试",
    body: { cards: [], characters: [], shots: [] },
  });
  await caller.promptLineage.getStoryProjection({ storyId: story!.id });
  return { caller, story: story! };
}

function turnInput(
  storyId: number,
  suffix: string,
  userContent = `问题-${suffix}`
) {
  const input = {
    storyId,
    clientTurnId: `turn-${suffix}`,
    userClientMessageId: `user-${suffix}`,
    assistantClientMessageId: `assistant-${suffix}`,
    userContent,
  };
  return {
    ...input,
    requestHash: computeStoryConversationTurnRequestHash(input),
  };
}

describe("mobile Story conversation turns", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "";
    resetMemoryStateForTesting();
  });

  it("generates from owned durable history and appends one complete logical turn", async () => {
    const { caller, story } = await seedStory();
    await caller.storyConversation.appendTurn({
      storyId: story.id,
      userMessage: { clientMessageId: "desktop-user", content: "桌面问题" },
      assistantMessage: {
        clientMessageId: "desktop-assistant",
        content: "桌面回答",
      },
    });
    const generateReply = vi.fn(async () => ({ reply: "手机回答" }));
    const input = turnInput(story.id, "owned", "手机问题");

    const generated = await generateMobileStoryConversationTurn(
      { ...input, userId: 801 },
      { generateReply }
    );
    expect(generated).toMatchObject({
      status: "completed",
      turn: {
        clientTurnId: "turn-owned",
        userContent: "手机问题",
        assistantContent: "手机回答",
        appendStatus: "pending",
      },
    });
    expect(generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        storyId: story.id,
        userId: 801,
        message: "手机问题",
        summary: expect.stringContaining("移动聊聊测试"),
        currentShots: [],
        storyCards: [],
        history: [
          expect.objectContaining({ role: "user", content: "桌面问题" }),
          expect.objectContaining({ role: "assistant", content: "桌面回答" }),
        ],
      })
    );

    const appended = await appendMobileStoryConversationTurn({
      storyId: story.id,
      userId: 801,
      clientTurnId: input.clientTurnId,
      requestHash: input.requestHash,
    });
    expect(appended.status).toBe("appended");
    const listed = await caller.storyConversation.list({ storyId: story.id });
    expect(listed.messages.map(message => message.content)).toEqual([
      "桌面问题",
      "桌面回答",
      "手机问题",
      "手机回答",
    ]);
  });

  it("recovers a completed response and exact append retry without another model call", async () => {
    const { caller, story } = await seedStory();
    const input = turnInput(story.id, "lost-response");
    const generateReply = vi.fn(async () => ({ reply: "唯一回答" }));

    await generateMobileStoryConversationTurn(
      { ...input, userId: 801 },
      { generateReply }
    );
    const recovered = await getMobileStoryConversationTurnStatus({
      storyId: story.id,
      userId: 801,
      clientTurnId: input.clientTurnId,
      requestHash: input.requestHash,
    });
    expect(recovered).toMatchObject({
      status: "completed",
      turn: { assistantContent: "唯一回答" },
    });

    await generateMobileStoryConversationTurn(
      { ...input, userId: 801 },
      { generateReply }
    );
    await appendMobileStoryConversationTurn({
      storyId: story.id,
      userId: 801,
      clientTurnId: input.clientTurnId,
      requestHash: input.requestHash,
    });
    await appendMobileStoryConversationTurn({
      storyId: story.id,
      userId: 801,
      clientTurnId: input.clientTurnId,
      requestHash: input.requestHash,
    });

    expect(generateReply).toHaveBeenCalledTimes(1);
    expect(
      (await caller.storyConversation.list({ storyId: story.id })).messages
    ).toHaveLength(2);
  });

  it("rejects turn and message identity collisions without changing the original", async () => {
    const { caller, story } = await seedStory();
    const first = turnInput(story.id, "collision", "原问题");
    const generateReply = vi.fn(async () => ({ reply: "原回答" }));
    await generateMobileStoryConversationTurn(
      { ...first, userId: 801 },
      { generateReply }
    );

    const changed = {
      ...turnInput(story.id, "collision", "篡改问题"),
      requestHash: first.requestHash,
    };
    await expect(
      generateMobileStoryConversationTurn(
        { ...changed, userId: 801 },
        { generateReply }
      )
    ).rejects.toBeInstanceOf(StoryConversationIdempotencyConflictError);

    const reusedUserId = turnInput(story.id, "other", "另一个问题");
    await expect(
      generateMobileStoryConversationTurn(
        {
          ...reusedUserId,
          userId: 801,
          userClientMessageId: first.userClientMessageId,
          requestHash: computeStoryConversationTurnRequestHash({
            ...reusedUserId,
            userClientMessageId: first.userClientMessageId,
          }),
        },
        { generateReply }
      )
    ).rejects.toBeInstanceOf(StoryConversationIdempotencyConflictError);
    expect(generateReply).toHaveBeenCalledTimes(1);
    expect(
      (await caller.storyConversation.list({ storyId: story.id })).messages
    ).toHaveLength(0);
  });

  it("makes caught failures explicitly retryable while stale pending work becomes unknown", async () => {
    const { story } = await seedStory();
    const failedInput = turnInput(story.id, "failed");
    const failure = vi.fn().mockRejectedValueOnce(new Error("provider 503"));
    const failed = await generateMobileStoryConversationTurn(
      { ...failedInput, userId: 801 },
      { generateReply: failure }
    );
    expect(failed).toMatchObject({ status: "failed" });

    const noImplicitRetry = await generateMobileStoryConversationTurn(
      { ...failedInput, userId: 801 },
      { generateReply: failure }
    );
    expect(noImplicitRetry.status).toBe("failed");
    expect(failure).toHaveBeenCalledTimes(1);

    failure.mockResolvedValueOnce({ reply: "重试成功" });
    const retried = await generateMobileStoryConversationTurn(
      { ...failedInput, userId: 801, retryFailed: true },
      { generateReply: failure }
    );
    expect(retried).toMatchObject({
      status: "completed",
      turn: { assistantContent: "重试成功", generationAttempt: 2 },
    });

    const pendingInput = turnInput(story.id, "unknown");
    let release: ((value: { reply: string }) => void) | undefined;
    const pendingReply = new Promise<{ reply: string }>(resolve => {
      release = resolve;
    });
    const pendingGeneration = generateMobileStoryConversationTurn(
      { ...pendingInput, userId: 801, now: 1_000 },
      { generateReply: () => pendingReply }
    );
    await vi.waitFor(async () => {
      const status = await getMobileStoryConversationTurnStatus({
        storyId: story.id,
        userId: 801,
        clientTurnId: pendingInput.clientTurnId,
        requestHash: pendingInput.requestHash,
        now: 1_000 + 10 * 60_000,
      });
      expect(status.status).toBe("unknown");
    });
    release?.({ reply: "迟到回答" });
    await expect(pendingGeneration).resolves.toMatchObject({
      status: "unknown",
    });
  });

  it("gives one concurrent caller generation ownership and keeps different pairs contiguous", async () => {
    const { caller, story } = await seedStory();
    const same = turnInput(story.id, "same");
    let release: ((value: { reply: string }) => void) | undefined;
    const replyPromise = new Promise<{ reply: string }>(resolve => {
      release = resolve;
    });
    const generateReply = vi.fn(() => replyPromise);
    const owner = generateMobileStoryConversationTurn(
      { ...same, userId: 801 },
      { generateReply }
    );
    await vi.waitFor(() => expect(generateReply).toHaveBeenCalledTimes(1));
    await expect(
      generateMobileStoryConversationTurn(
        { ...same, userId: 801 },
        { generateReply }
      )
    ).resolves.toMatchObject({ status: "pending" });
    release?.({ reply: "同一结果" });
    await expect(owner).resolves.toMatchObject({ status: "completed" });
    expect(generateReply).toHaveBeenCalledTimes(1);

    const left = turnInput(story.id, "left");
    const right = turnInput(story.id, "right");
    await generateMobileStoryConversationTurn(
      { ...left, userId: 801 },
      { generateReply: async () => ({ reply: "左回答" }) }
    );
    await generateMobileStoryConversationTurn(
      { ...right, userId: 801 },
      { generateReply: async () => ({ reply: "右回答" }) }
    );
    await Promise.all([
      appendMobileStoryConversationTurn({
        storyId: story.id,
        userId: 801,
        clientTurnId: left.clientTurnId,
        requestHash: left.requestHash,
      }),
      appendMobileStoryConversationTurn({
        storyId: story.id,
        userId: 801,
        clientTurnId: right.clientTurnId,
        requestHash: right.requestHash,
      }),
    ]);
    const messages = (
      await caller.storyConversation.list({ storyId: story.id })
    ).messages;
    const pairs = messages.slice(-4).map(message => message.role);
    expect(pairs).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("rejects another user's Story before exposing history or invoking the model", async () => {
    const { story } = await seedStory(801);
    const input = turnInput(story.id, "unowned");
    const generateReply = vi.fn(async () => ({ reply: "不应生成" }));

    await expect(
      generateMobileStoryConversationTurn(
        { ...input, userId: 802 },
        { generateReply }
      )
    ).rejects.toMatchObject({ name: "PromptLineageOwnershipError" });
    await expect(
      getMobileStoryConversationTurnStatus({
        storyId: story.id,
        userId: 802,
        clientTurnId: input.clientTurnId,
        requestHash: input.requestHash,
      })
    ).rejects.toMatchObject({ name: "PromptLineageOwnershipError" });
    expect(generateReply).not.toHaveBeenCalled();
  });
});
