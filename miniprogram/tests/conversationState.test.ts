import { describe, expect, it } from "vitest";

import {
  applyConversationTurnEvent,
  computeTurnRequestHash,
  createConversationTurn,
  findUnknownTurn,
  hasPendingTurn,
  mergeConversationProjection,
  normalizeConversationTurn,
} from "../src/core/conversationState";
import { RECOVERY_TTL_MS } from "../src/core/recoveryState";

const SCOPE = "demo-scope-aaaa";
const NOW = 1_760_000_000_000;

function turn(storyId = 1186, content = "今天想聊聊那杯酒") {
  return createConversationTurn({
    scope: SCOPE,
    storyId,
    userContent: content,
    idFactory: () => "fixed-1",
    now: NOW,
  });
}

describe("整轮身份与幂等键", () => {
  it("发送前就定下 turn/message id 与 requestHash", () => {
    const created = turn();
    expect(created.clientTurnId).toBe("turn-fixed-1");
    expect(created.userClientMessageId).toBe("user-fixed-1");
    expect(created.assistantClientMessageId).toBe("assistant-fixed-1");
    expect(created.requestHash).toMatch(/^sct1-[0-9a-f]{32}$/);
    expect(created.status).toBe("replying");
    expect(created.expiresAt).toBe(NOW + RECOVERY_TTL_MS);
  });

  it("同样输入得到同样 hash，任一字段变化就换 hash", () => {
    const base = {
      storyId: 1186,
      clientTurnId: "turn-1",
      userClientMessageId: "user-1",
      assistantClientMessageId: "assistant-1",
      userContent: "同一句话",
    };
    expect(computeTurnRequestHash(base)).toBe(computeTurnRequestHash(base));
    expect(computeTurnRequestHash({ ...base, storyId: 1187 })).not.toBe(
      computeTurnRequestHash(base),
    );
    expect(computeTurnRequestHash({ ...base, userContent: "换一句" })).not.toBe(
      computeTurnRequestHash(base),
    );
  });

  it("前后空白不影响 hash：同一轮重试不会变成新一轮", () => {
    const base = {
      storyId: 1186,
      clientTurnId: "turn-1",
      userClientMessageId: "user-1",
      assistantClientMessageId: "assistant-1",
      userContent: "同一句话",
    };
    expect(computeTurnRequestHash({ ...base, userContent: "  同一句话  " })).toBe(
      computeTurnRequestHash(base),
    );
  });

  it("空内容不允许发送", () => {
    expect(() =>
      createConversationTurn({ scope: SCOPE, storyId: 1, userContent: "   " }),
    ).toThrow(/不能为空/);
  });
});

describe("pending → unknown → 查询 → synced", () => {
  it("未知结果保留原 turn 身份，不生成第二次请求", () => {
    const created = turn();
    const unknown = applyConversationTurnEvent(created, {
      type: "generation_unknown",
      error: "网络中断，结果未知",
      now: NOW + 1000,
    });
    expect(unknown.status).toBe("generation-unknown");
    expect(unknown.clientTurnId).toBe(created.clientTurnId);
    expect(unknown.requestHash).toBe(created.requestHash);
    expect(findUnknownTurn([unknown])).toBe(unknown);

    // 查询回来发现服务端其实已经生成：直接落到 synced，不重跑模型。
    const completed = applyConversationTurnEvent(unknown, {
      type: "generation_completed",
      assistantContent: "那杯酒的故事我记下了",
      now: NOW + 2000,
    });
    const synced = applyConversationTurnEvent(completed, {
      type: "synced",
      now: NOW + 3000,
    });
    expect(synced.status).toBe("synced");
    expect(synced.requestHash).toBe(created.requestHash);
    expect(synced.assistantContent).toBe("那杯酒的故事我记下了");
  });

  it("replying 和 persisting 都算占用额度，unknown 不算 pending 但要单独处理", () => {
    const created = turn();
    expect(hasPendingTurn([created])).toBe(true);
    const persisting = applyConversationTurnEvent(created, {
      type: "generation_completed",
      assistantContent: "回答",
      now: NOW + 1,
    });
    expect(persisting.status).toBe("persisting");
    expect(hasPendingTurn([persisting])).toBe(true);

    const unknown = applyConversationTurnEvent(created, {
      type: "generation_unknown",
      error: "未知",
      now: NOW + 1,
    });
    expect(hasPendingTurn([unknown])).toBe(false);
    expect(findUnknownTurn([unknown])).not.toBeNull();

    const synced = applyConversationTurnEvent(persisting, {
      type: "synced",
      now: NOW + 2,
    });
    expect(hasPendingTurn([synced])).toBe(false);
    expect(findUnknownTurn([synced])).toBeNull();
  });

  it("落库失败保留已生成的回答，不丢文字", () => {
    const persisting = applyConversationTurnEvent(turn(), {
      type: "generation_completed",
      assistantContent: "已经生成好的回答",
      now: NOW + 1,
    });
    const failed = applyConversationTurnEvent(persisting, {
      type: "append_failed",
      error: "保存失败",
      now: NOW + 2,
    });
    expect(failed.status).toBe("persistence-failed");
    expect(failed.assistantContent).toBe("已经生成好的回答");
  });

  it("空回答不允许当作成功", () => {
    expect(() =>
      applyConversationTurnEvent(turn(), {
        type: "generation_completed",
        assistantContent: "   ",
        now: NOW,
      }),
    ).toThrow(/不能为空/);
  });
});

describe("恢复记录归一化", () => {
  it("Story A 的记录不会被 Story B 读出来", () => {
    const storyA = turn(1186);
    expect(normalizeConversationTurn(storyA, SCOPE, 1186)).not.toBeNull();
    expect(normalizeConversationTurn(storyA, SCOPE, 1187)).toBeNull();
  });

  it("别的账号作用域读不出本作用域的记录", () => {
    const created = turn();
    expect(normalizeConversationTurn(created, "demo-scope-bbbb", 1186)).toBeNull();
  });

  it("被改过内容但 hash 没同步的记录一律丢弃", () => {
    const created = turn();
    const tampered = { ...created, userContent: "被人改过的内容" };
    expect(normalizeConversationTurn(tampered, SCOPE, 1186)).toBeNull();
  });

  it("状态值不在枚举内、字段缺失都丢弃", () => {
    const created = turn();
    expect(
      normalizeConversationTurn({ ...created, status: "whatever" }, SCOPE, 1186),
    ).toBeNull();
    expect(
      normalizeConversationTurn({ ...created, createdAt: "早上" }, SCOPE, 1186),
    ).toBeNull();
    expect(normalizeConversationTurn(null, SCOPE, 1186)).toBeNull();
    expect(normalizeConversationTurn([created], SCOPE, 1186)).toBeNull();
  });
});

describe("服务端消息与本地恢复的合并投影", () => {
  it("服务端已有的两条消息会让恢复记录退场", () => {
    const created = turn();
    const result = mergeConversationProjection({
      serverMessages: [
        {
          id: 1,
          role: "user",
          content: "今天想聊聊那杯酒",
          clientMessageId: created.userClientMessageId,
          createdAt: new Date(NOW).toISOString(),
        },
        {
          id: 2,
          role: "assistant",
          content: "记下了",
          clientMessageId: created.assistantClientMessageId,
          createdAt: new Date(NOW + 1000).toISOString(),
        },
      ],
      recoveryTurns: [created],
    });
    expect(result.remainingRecoveryTurns).toEqual([]);
    expect(result.messages.map(message => message.source)).toEqual([
      "server",
      "server",
    ]);
  });

  it("服务端还没有的那半轮继续由本地恢复渲染，并带状态标识", () => {
    const created = turn();
    const result = mergeConversationProjection({
      serverMessages: [],
      recoveryTurns: [created],
    });
    expect(result.remainingRecoveryTurns).toHaveLength(1);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      role: "user",
      source: "recovery",
      turnStatus: "replying",
    });
  });

  it("同一轮时间戳相同时，问永远排在答前面", () => {
    // mock transport 是瞬时的：user.createdAt 与 assistant.updatedAt 会完全相等。
    const created = turn();
    const answered = applyConversationTurnEvent(created, {
      type: "generation_completed",
      assistantContent: "瞬时回答",
      now: NOW,
    });
    const result = mergeConversationProjection({
      serverMessages: [],
      recoveryTurns: [answered],
    });
    expect(result.messages.map(message => message.role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("system 消息不进入聊天视图", () => {
    const result = mergeConversationProjection({
      serverMessages: [
        {
          id: 1,
          role: "system",
          content: "系统提示",
          clientMessageId: null,
          createdAt: new Date(NOW).toISOString(),
        },
      ],
      recoveryTurns: [],
    });
    expect(result.messages).toEqual([]);
  });
});
