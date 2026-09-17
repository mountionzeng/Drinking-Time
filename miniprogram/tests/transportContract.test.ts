import { describe, expect, it } from "vitest";

import {
  validateWorkspaceContract as validateClient,
} from "../src/contracts/workspace";
import {
  validateWorkspaceContract as validateServer,
} from "../../shared/miniprogramWorkspace";
import { computeTurnRequestHash } from "../src/core/conversationState";

function expectParity(name: string, value: unknown, expected: boolean) {
  expect(validateServer(name, value).ok).toBe(expected);
  expect(validateClient(name, value).ok).toBe(expected);
}

describe("workspace wire contract parity", () => {
  it("accepts a versioned JSON-only story creation request", () => {
    expectParity("StoryCreateRequest", {
      contractVersion: 1,
      clientOperationId: "create-story-01",
      title: "我的故事",
    }, true);
  });

  it("returns one complete Story receipt with an immediately editable document", () => {
    expectParity("StoryCreateResponse", {
      contractVersion: 1,
      receipt: {
        contractVersion: 1,
        clientOperationId: "create-story-01",
        requestHash: "scr1-" + "a".repeat(32),
        status: "complete",
        story: {
          contractVersion: 1,
          id: 7,
          title: "我的故事",
          updatedAt: 1,
        },
      },
      document: {
        contractVersion: 1,
        storyId: 7,
        storyRevision: 1,
        versionId: "version-01",
        platform: "xiaohongshu",
        body: "",
        bodyRevision: 1,
        updatedAt: 1,
      },
    }, true);
  });

  it("accepts the existing canonical turn hash and message identities", () => {
    const input = {
      storyId: 7,
      clientTurnId: "turn-0001",
      userContent: "继续写",
      userClientMessageId: "user-message-01",
      assistantClientMessageId: "assistant-message-01",
    };
    expectParity("SubmitTurnRequest", {
      contractVersion: 1,
      ...input,
      requestHash: computeTurnRequestHash(input),
    }, true);
  });

  it("rejects wrong versions and unknown fields", () => {
    expectParity("StoryCreateRequest", {
      contractVersion: 2,
      clientOperationId: "create-story-01",
      title: "我的故事",
    }, false);
    expectParity("StoryCreateRequest", {
      contractVersion: 1,
      clientOperationId: "create-story-01",
      title: "我的故事",
      surprise: true,
    }, false);
  });

  it("requires integer minor-unit money", () => {
    expectParity("BalanceSummary", {
      contractVersion: 1,
      currency: "CNY",
      minorPerMajor: 1_000_000,
      ledgerMinor: 3000,
      reservedMinor: 0,
      availableMinor: 3000,
      lastSettledCostMinor: 12.5,
    }, false);
    expectParity("BalanceSummary", {
      contractVersion: 1,
      currency: "CNY",
      minorPerMajor: 1_000_000,
      ledgerMinor: 3000,
      reservedMinor: 0,
      availableMinor: 3000,
      lastSettledCostMinor: 125,
    }, true);
    expectParity("BalanceSummary", {
      contractVersion: 1,
      currency: "CNY",
      minorPerMajor: 100,
      ledgerMinor: 3000,
      reservedMinor: 0,
      availableMinor: 3000,
      lastSettledCostMinor: 125,
    }, false);
  });

  it.each(["userId", "openid", "price", "priceMinor"])(
    "rejects client-supplied authority field %s",
    forbidden => {
      expectParity("SubmitTurnRequest", {
        contractVersion: 1,
        storyId: 7,
        clientTurnId: "turn-0001",
        requestHash: "sct1-" + "a".repeat(32),
        userClientMessageId: "user-message-01",
        assistantClientMessageId: "assistant-message-01",
        userContent: "继续写",
        [forbidden]: forbidden === "userId" ? 1 : "attacker-controlled",
      }, false);
    },
  );

  it("requires a version for document writes", () => {
    expectParity("DocumentSaveRequest", {
      storyId: 7,
      versionId: "version-01",
      baseBodyRevision: 1,
      body: "正文",
    }, false);
  });

  it("validates a complete open-story snapshot through nested refs and arrays", () => {
    expectParity("WorkspaceSnapshot", {
      contractVersion: 1,
      story: { contractVersion: 1, id: 7, title: "我的故事", updatedAt: 1 },
      messages: [{
        contractVersion: 1,
        id: 9,
        role: "assistant",
        content: "我们继续。",
        clientMessageId: "assistant-message-01",
        createdAt: "2026-09-03T00:00:00Z",
      }],
      document: {
        contractVersion: 1,
        storyId: 7,
        storyRevision: 2,
        versionId: "version-01",
        platform: "wechat_moments",
        body: "正文",
        bodyRevision: 3,
        updatedAt: 1,
      },
      balance: {
        contractVersion: 1,
        currency: "CNY",
        minorPerMajor: 1_000_000,
        ledgerMinor: 3000,
        reservedMinor: 100,
        availableMinor: 2900,
        lastSettledCostMinor: 25,
      },
      recentCharges: [{
        contractVersion: 1,
        ledgerEntryId: "ledger-01",
        storyId: 7,
        clientTurnId: "turn-0001",
        receiptId: "receipt-01",
        amountMinor: 25,
        currency: "CNY",
        minorPerMajor: 1_000_000,
        settledAt: 1,
        label: "聊聊 · 一轮",
      }],
    }, true);
  });

  it("exposes a versioned error envelope without collapsing unknown results", () => {
    expectParity("WorkspaceErrorEnvelope", {
      contractVersion: 1,
      ok: false,
      error: {
        contractVersion: 1,
        kind: "unknown-result",
        message: "结果仍在确认",
        retryable: false,
        resultUnknown: true,
      },
    }, true);
  });
});
