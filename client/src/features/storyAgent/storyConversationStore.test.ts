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

  it("保留故事体里的真实角色，并折叠旧投影的重复开场污染", () => {
    const opening =
      "你好，我是小酌——会听你说话的朋友，也是帮你把一件今天的小事做成小短片的助手。\n\n今天有没有一件很小的事，在你心里留下了一点感觉？不用重要，随便说。";
    const current = [
      {
        id: "first-question",
        role: "assistant" as const,
        content: opening,
        timestamp: 1,
      },
      {
        id: "user-1",
        role: "user" as const,
        content: "把最后一镜挪到开头",
        timestamp: 2,
      },
      {
        id: "assistant-1",
        role: "assistant" as const,
        content: "我把修改放成了候选版本。",
        timestamp: 3,
      },
    ];

    const merged = mergeStoryConversationMessages({
      current,
      messages: [
        {
          id: 1,
          role: "user",
          content: opening,
          clientMessageId: "legacy-opening-1",
          candidateRevisionId: null,
          createdAt: "2026-07-18T10:28:59.156Z",
        },
        {
          id: 2,
          role: "user",
          content: opening,
          clientMessageId: "legacy-opening-2",
          candidateRevisionId: null,
          createdAt: "2026-07-18T10:28:59.156Z",
        },
        {
          id: 3,
          role: "user",
          content: "我把修改放成了候选版本。",
          clientMessageId: "assistant-1",
          candidateRevisionId: null,
          createdAt: "2026-07-18T10:28:59.156Z",
        },
      ],
      references: [],
      candidates: [],
    });

    expect(merged.filter(message => message.content === opening)).toHaveLength(1);
    expect(merged.find(message => message.id === "assistant-1")?.role).toBe(
      "assistant",
    );
  });

  it("干净服务端投影会替换同内容的旧本地缓存副本", () => {
    const merged = mergeStoryConversationMessages({
      current: [
        {
          id: "user-canonical",
          role: "user",
          content: "把最后一镜挪到开头",
          timestamp: 10,
        },
        {
          id: "user-stale-copy",
          role: "user",
          content: "把最后一镜挪到开头",
          timestamp: 20,
        },
        {
          id: "assistant-stale-copy",
          role: "user",
          content: "我把修改放成了候选版本。",
          timestamp: 21,
        },
      ],
      messages: [
        {
          id: 10,
          role: "user",
          content: "把最后一镜挪到开头",
          clientMessageId: "user-canonical",
          candidateRevisionId: null,
          createdAt: "2026-07-18T10:00:00.000Z",
        },
        {
          id: 11,
          role: "assistant",
          content: "我把修改放成了候选版本。",
          clientMessageId: "assistant-canonical",
          candidateRevisionId: null,
          createdAt: "2026-07-18T10:00:01.000Z",
        },
      ],
      references: [],
      candidates: [],
    });

    expect(merged).toHaveLength(2);
    expect(merged.map(message => message.id)).toEqual([
      "user-canonical",
      "assistant-canonical",
    ]);
    expect(merged[1].role).toBe("assistant");
  });
});
