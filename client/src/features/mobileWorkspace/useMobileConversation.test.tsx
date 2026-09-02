import { describe, expect, it, vi } from "vitest";

import {
  createMobileConversationRecoveryTurn,
  type MobileConversationRecoveryTurn,
} from "./mobileConversationStore";
import { runMobileConversationTurn } from "./useMobileConversation";

function turn(): MobileConversationRecoveryTurn {
  return createMobileConversationRecoveryTurn({
    userId: 5,
    storyId: 8,
    userContent: "继续聊",
    idFactory: () => "runner",
    now: 1,
  });
}

function completedServerTurn(input: MobileConversationRecoveryTurn) {
  return {
    status: "completed" as const,
    staleContext: false,
    turn: {
      clientTurnId: input.clientTurnId,
      assistantContent: "服务端回答",
      appendStatus: "pending" as const,
    },
  };
}

describe("runMobileConversationTurn", () => {
  it("moves through replying, persisting and synced only after append succeeds", async () => {
    const initial = turn();
    const observed: string[] = [];
    const api = {
      generate: vi.fn(async () => completedServerTurn(initial)),
      status: vi.fn(),
      append: vi.fn(async () => ({ status: "appended" as const })),
    };
    const result = await runMobileConversationTurn({
      turn: initial,
      api,
      onTurn: next => observed.push(next.status),
    });

    expect(result.status).toBe("synced");
    expect(observed).toEqual(["persisting", "synced"]);
    expect(api.generate).toHaveBeenCalledTimes(1);
    expect(api.append).toHaveBeenCalledWith({
      storyId: 8,
      clientTurnId: initial.clientTurnId,
      requestHash: initial.requestHash,
    });
  });

  it("recovers a lost generation response through status without invoking the model twice", async () => {
    const initial = turn();
    const api = {
      generate: vi.fn().mockRejectedValue(new Error("response lost")),
      status: vi.fn(async () => completedServerTurn(initial)),
      append: vi.fn(async () => ({ status: "appended" as const })),
    };
    const result = await runMobileConversationTurn({ turn: initial, api });

    expect(result).toMatchObject({
      status: "synced",
      assistantContent: "服务端回答",
    });
    expect(api.generate).toHaveBeenCalledTimes(1);
    expect(api.status).toHaveBeenCalledTimes(1);
  });

  it("recognizes an append that landed before its response was lost", async () => {
    const initial = turn();
    const api = {
      generate: vi.fn(async () => completedServerTurn(initial)),
      append: vi.fn().mockRejectedValue(new Error("append response lost")),
      status: vi.fn(async () => ({
        ...completedServerTurn(initial),
        turn: {
          ...completedServerTurn(initial).turn,
          appendStatus: "appended" as const,
        },
      })),
    };
    const result = await runMobileConversationTurn({ turn: initial, api });
    expect(result.status).toBe("synced");
    expect(api.append).toHaveBeenCalledTimes(1);
  });

  it("keeps the assistant answer when append rejects and status is still pending", async () => {
    const initial = turn();
    const observed: MobileConversationRecoveryTurn[] = [];
    const api = {
      generate: vi.fn(async () => completedServerTurn(initial)),
      append: vi.fn().mockRejectedValue(new Error("append rejected")),
      status: vi.fn(async () => ({
        status: "pending" as const,
        staleContext: false,
        turn: {
          assistantContent: "服务端回答",
          appendStatus: "pending" as const,
        },
      })),
    };

    const result = await runMobileConversationTurn({
      turn: initial,
      api,
      onTurn: next => observed.push(next),
    });

    expect(result).toMatchObject({
      status: "persistence-failed",
      assistantContent: "服务端回答",
      error: "append rejected",
    });
    expect(observed.map(value => value.status)).toEqual([
      "persisting",
      "persistence-failed",
    ]);
    expect(observed.every(value => value.status !== "synced")).toBe(true);
  });

  it("keeps the assistant answer when append and its status recovery both reject", async () => {
    const initial = turn();
    const api = {
      generate: vi.fn(async () => completedServerTurn(initial)),
      append: vi.fn().mockRejectedValue(new Error("append rejected")),
      status: vi.fn().mockRejectedValue(new Error("status unavailable")),
    };

    const result = await runMobileConversationTurn({ turn: initial, api });

    expect(result).toMatchObject({
      status: "persistence-failed",
      assistantContent: "服务端回答",
      error: "append rejected",
    });
  });

  it("marks a completed response without assistant content unknown, never synced", async () => {
    const initial = turn();
    const observed: string[] = [];
    const api = {
      generate: vi.fn(async () => ({
        status: "completed" as const,
        staleContext: false,
        turn: { assistantContent: null, appendStatus: "pending" as const },
      })),
      status: vi.fn(),
      append: vi.fn(),
    };

    const result = await runMobileConversationTurn({
      turn: initial,
      api,
      onTurn: next => observed.push(next.status),
    });

    expect(result).toMatchObject({
      status: "generation-unknown",
      assistantContent: null,
    });
    expect(observed).toEqual(["generation-unknown"]);
    expect(api.append).not.toHaveBeenCalled();
  });

  it("keeps provider failure retryable with the original identities", async () => {
    const initial = turn();
    const api = {
      generate: vi.fn(async () => ({
        status: "failed" as const,
        staleContext: false,
        turn: { assistantContent: null, appendStatus: "pending" as const },
      })),
      status: vi.fn(),
      append: vi.fn(),
    };
    const failed = await runMobileConversationTurn({ turn: initial, api });
    expect(failed).toMatchObject({
      status: "generation-failed",
      userContent: "继续聊",
      assistantContent: null,
    });

    api.generate.mockResolvedValueOnce(completedServerTurn(initial) as never);
    api.append.mockResolvedValueOnce({ status: "appended" } as never);
    await runMobileConversationTurn({
      turn: failed,
      api,
      retryFailed: true,
    });
    expect(api.generate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        clientTurnId: initial.clientTurnId,
        requestHash: initial.requestHash,
        retryFailed: true,
      })
    );
  });

  it("does not automatically regenerate an unknown provider outcome", async () => {
    const initial = { ...turn(), status: "generation-unknown" as const };
    const api = {
      generate: vi.fn(),
      status: vi.fn(async () => ({
        status: "unknown" as const,
        staleContext: false,
        turn: { assistantContent: null, appendStatus: "pending" as const },
      })),
      append: vi.fn(),
    };
    const result = await runMobileConversationTurn({
      turn: initial,
      api,
      recoverFirst: true,
    });
    expect(result.status).toBe("generation-unknown");
    expect(api.generate).not.toHaveBeenCalled();
  });
});
