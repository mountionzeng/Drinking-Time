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
  it("preserves module context and its preview during recovery, scoped to the account and story", () => {
    const store = memoryStorage();
    const turn = createMobileConversationRecoveryTurn({
      userId: 1,
      storyId: 2,
      userContent: "怎么改",
    });
    turn.writingContext = {
      draft: "正文",
      cursor: 0,
      fullDraft: true,
      layoutMemory: {
        storyId: 2,
        scope: "layout:v1",
        total: 1,
        recent: [
          {
            kind: "style",
            summary: "改成加粗浅色字",
            undone: false,
            at: 1,
            sameSource: true,
          },
        ],
      },
      module: {
        storyId: 2,
        scope: "layout:v1",
        moduleId: "m",
        kind: "text",
        page: 1,
        pageCount: 1,
        rect: { x: 1, y: 1, width: 100, height: 100 },
        text: "选中内容",
        pageText: "正文",
        pagePreview: "data:image/jpeg;base64,AAAA",
      },
    };
    saveMobileConversationRecovery(store, 1, 2, [turn]);
    expect(
      loadMobileConversationRecovery(store, 1, 2)[0].writingContext
    ).toEqual(turn.writingContext);
    expect(loadMobileConversationRecovery(store, 3, 2)).toEqual([]);
    expect(loadMobileConversationRecovery(store, 1, 3)).toEqual([]);
    turn.writingContext.module!.storyId = 99;
    store.setItem(mobileConversationRecoveryKey(1, 2), JSON.stringify([turn]));
    expect(loadMobileConversationRecovery(store, 1, 2)).toEqual([]);
    turn.writingContext.module!.storyId = 2;
    turn.writingContext.layoutMemory!.storyId = 99;
    store.setItem(mobileConversationRecoveryKey(1, 2), JSON.stringify([turn]));
    expect(loadMobileConversationRecovery(store, 1, 2)).toEqual([]);
  });
  it("keeps same-time persisted turns in question-answer order, regardless of client IDs", () => {
    const messages = [
      {
        id: 9,
        role: "user" as const,
        content: "第一问",
        clientMessageId: "user-z",
      },
      {
        id: 10,
        role: "assistant" as const,
        content: "第一答",
        clientMessageId: "assistant-z",
      },
      {
        id: 11,
        role: "user" as const,
        content: "第二问",
        clientMessageId: "user-a",
      },
      {
        id: 12,
        role: "assistant" as const,
        content: "第二答",
        clientMessageId: "assistant-a",
      },
    ].map(message => ({ ...message, createdAt: "2026-10-13T08:00:00.000Z" }));
    const merged = mergeMobileConversationProjection({
      serverMessages: [...messages].reverse(),
      recoveryTurns: [],
    });
    expect(merged.messages.map(message => message.content)).toEqual([
      "第一问",
      "第一答",
      "第二问",
      "第二答",
    ]);
  });

  it("keeps a local question before its answer when both have the same timestamp", () => {
    const turn = applyMobileConversationTurnEvent(
      createMobileConversationRecoveryTurn({
        userId: 1,
        storyId: 2,
        userContent: "问题",
        idFactory: () => "same-time",
        now: 100,
      }),
      { type: "generation_completed", assistantContent: "回答", now: 100 }
    );
    const merged = mergeMobileConversationProjection({
      serverMessages: [],
      recoveryTurns: [turn],
    });
    expect(merged.messages.map(message => message.content)).toEqual([
      "问题",
      "回答",
    ]);
  });

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

describe("mobile sequential queue", () => {
  it("retains queued messages and their exact draft context across recovery", async () => {
    const storage = memoryStorage();
    const turn = createMobileConversationRecoveryTurn({
      userId: 2,
      storyId: 7,
      userContent: "第二个想法",
    });
    turn.status = "queued";
    turn.writingContext = {
      draft: "发送时的未保存正文",
      cursor: 9,
      fullDraft: true,
      selection: { start: 0, end: 2 },
    };
    saveMobileConversationRecovery(storage, 2, 7, [turn]);
    expect(loadMobileConversationRecovery(storage, 2, 7)).toEqual([turn]);
    expect(loadMobileConversationRecovery(storage, 3, 7)).toEqual([]);
  });
  it("never skips an earlier unknown or failed turn to send a later queued message", async () => {
    const { nextMobileQueuedTurn } = await import("./mobileConversationStore");
    const first = createMobileConversationRecoveryTurn({
      userId: 2,
      storyId: 7,
      userContent: "第一条",
    });
    const second = {
      ...createMobileConversationRecoveryTurn({
        userId: 2,
        storyId: 7,
        userContent: "第二条",
      }),
      status: "queued" as const,
    };
    for (const status of [
      "replying",
      "generation-unknown",
      "generation-failed",
      "persistence-failed",
    ] as const)
      expect(nextMobileQueuedTurn([{ ...first, status }, second])).toBeNull();
    expect(nextMobileQueuedTurn([{ ...first, status: "synced" }, second])).toBe(
      second
    );
  });
});
