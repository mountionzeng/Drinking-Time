import { describe, expect, it } from "vitest";
import { mergeStoryConversationMessages } from "./storyConversationStore";

describe("mergeStoryConversationMessages", () => {
  it("deduplicates by client message id and restores selection candidates", () => {
    const merged = mergeStoryConversationMessages({
      current: [
        {
          id: "user-1",
          role: "user",
          content: "本地消息",
          timestamp: 1,
        },
      ],
      messages: [
        {
          id: 10,
          role: "user",
          content: "服务端消息",
          clientMessageId: "user-1",
          candidateRevisionId: null,
          createdAt: "2026-06-30T00:00:00.000Z",
        },
        {
          id: 11,
          role: "assistant",
          content: "候选已准备",
          clientMessageId: "assistant-1",
          candidateRevisionId: 42,
          createdAt: "2026-06-30T00:00:01.000Z",
        },
      ],
      references: [
        {
          messageId: 10,
          selection: {
            sourceType: "shot",
            sourceId: "0:dialogue",
            selectedText: "台词",
          },
        },
      ],
      candidates: [
        {
          messageId: 11,
          revisionId: 42,
          nodeId: 7,
          expectedVersion: 5,
          label: "dialogue",
          status: "pending",
        },
      ],
    });

    expect(merged).toHaveLength(2);
    expect(merged.find(message => message.id === "user-1")).toMatchObject({
      content: "服务端消息",
      selectionQuote: { sourceType: "shot" },
    });
    expect(
      merged.find(message => message.id === "assistant-1")?.promptCandidate,
    ).toMatchObject({ revisionId: 42, status: "pending" });
  });
});
