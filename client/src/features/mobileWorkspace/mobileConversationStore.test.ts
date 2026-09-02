import { describe, expect, it } from "vitest";

import {
  applyMobileConversationTurnEvent,
  createMobileConversationRecoveryTurn,
  loadMobileConversationRecovery,
  mergeMobileConversationProjection,
  mobileConversationRecoveryKey,
  saveMobileConversationRecovery,
} from "./mobileConversationStore";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("mobile conversation recovery store", () => {
  it("fixes one logical identity before generation and models both durability phases", () => {
    const turn = createMobileConversationRecoveryTurn({
      userId: 11,
      storyId: 22,
      userContent: "手机问题",
      idFactory: () => "fixed-id",
      now: 100,
    });
    expect(turn).toMatchObject({
      userId: 11,
      storyId: 22,
      clientTurnId: "turn-fixed-id",
      userClientMessageId: "user-fixed-id",
      assistantClientMessageId: "assistant-fixed-id",
      userContent: "手机问题",
      status: "replying",
    });
    expect(turn.requestHash).toMatch(/^sct1-/);

    const completed = applyMobileConversationTurnEvent(turn, {
      type: "generation_completed",
      assistantContent: "手机回答",
      now: 200,
    });
    expect(completed).toMatchObject({
      status: "persisting",
      assistantContent: "手机回答",
    });
    const failed = applyMobileConversationTurnEvent(completed, {
      type: "append_failed",
      error: "offline",
      now: 300,
    });
    expect(failed).toMatchObject({
      status: "persistence-failed",
      userContent: "手机问题",
      assistantContent: "手机回答",
      error: "offline",
    });
    expect(
      applyMobileConversationTurnEvent(failed, {
        type: "append_started",
        now: 400,
      }).status
    ).toBe("persisting");
  });

  it("retains generation failures and unknown outcomes without inventing a reply", () => {
    const initial = createMobileConversationRecoveryTurn({
      userId: 1,
      storyId: 2,
      userContent: "别丢掉我",
      idFactory: () => "failure",
      now: 1,
    });
    const failed = applyMobileConversationTurnEvent(initial, {
      type: "generation_failed",
      error: "provider 503",
      now: 2,
    });
    const unknown = applyMobileConversationTurnEvent(initial, {
      type: "generation_unknown",
      error: "response lost",
      now: 3,
    });
    expect(failed).toMatchObject({
      status: "generation-failed",
      userContent: "别丢掉我",
      assistantContent: null,
    });
    expect(unknown.status).toBe("generation-unknown");
  });

  it("deduplicates recovery messages against the durable projection", () => {
    const turn = applyMobileConversationTurnEvent(
      createMobileConversationRecoveryTurn({
        userId: 7,
        storyId: 9,
        userContent: "本地问题",
        idFactory: () => "dedupe",
        now: 1,
      }),
      { type: "generation_completed", assistantContent: "本地回答", now: 2 }
    );
    const merged = mergeMobileConversationProjection({
      serverMessages: [
        {
          id: 1,
          role: "user",
          content: "服务端问题",
          clientMessageId: turn.userClientMessageId,
          createdAt: "2026-09-01T00:00:00.000Z",
        },
        {
          id: 2,
          role: "assistant",
          content: "服务端回答",
          clientMessageId: turn.assistantClientMessageId,
          createdAt: "2026-09-01T00:00:01.000Z",
        },
      ],
      recoveryTurns: [turn],
    });
    expect(merged.messages.map(message => message.content)).toEqual([
      "服务端问题",
      "服务端回答",
    ]);
    expect(merged.remainingRecoveryTurns).toEqual([]);
  });

  it("persists only the exact numeric identity and Story scope", () => {
    const storage = memoryStorage();
    const turn = createMobileConversationRecoveryTurn({
      userId: 41,
      storyId: 73,
      userContent: "私有内容",
      idFactory: () => "scoped",
      now: 1,
    });
    const key = mobileConversationRecoveryKey(41, 73);
    expect(key).toBe("dt:mobile:conversation:v1:41:73");
    expect(key).not.toContain("@");
    saveMobileConversationRecovery(storage, 41, 73, [turn]);
    expect(loadMobileConversationRecovery(storage, 41, 73)).toHaveLength(1);
    expect(loadMobileConversationRecovery(storage, 42, 73)).toEqual([]);
    expect(loadMobileConversationRecovery(storage, 41, 74)).toEqual([]);
  });
});
